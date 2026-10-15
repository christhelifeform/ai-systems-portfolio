// Excerpt from a private Next.js app. Provider adapters, models.ts and types are not included.
// AI Router
// Intelligent routing of AI requests to optimal providers

import { createClient } from '@supabase/supabase-js';
import { getProvider } from './providers';
import { getDefaultModelForTask, calculateCost, MODEL_CONFIGS } from './models';
import {
    AIRequest,
    AIResponse,
    StreamChunk,
    ModelConfig,
    AIProvider,
    AIError,
    RateLimitError
} from './types';
import { logger } from './logger';

export class AIRouter {
    private supabase;

    constructor() {
        this.supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
    }

    /**
     * Main entry point for AI requests
     */
    async complete(request: AIRequest): Promise<AIResponse> {
        const startTime = Date.now();

        try {
            // 1. Select optimal model
            const modelConfig = this.selectModel(request);

            // 2. Get provider instance
            const provider = getProvider(modelConfig.provider);

            // 3. Execute request
            const response = await provider.complete({
                model: modelConfig.model,
                messages: request.messages,
                systemPrompt: request.systemPrompt,
                temperature: request.temperature ?? modelConfig.defaultTemperature,
                maxTokens: request.maxTokens ?? modelConfig.defaultMaxTokens
            });

            const latency = Date.now() - startTime;

            // 4. Calculate cost
            const cost = calculateCost(
                modelConfig,
                response.usage.inputTokens,
                response.usage.outputTokens
            );

            // 5. Track usage
            await this.trackUsage({
                request,
                response,
                modelConfig,
                cost,
                latency,
                status: 'success'
            });

            // 6. Return normalized response
            return {
                content: response.content,
                provider: modelConfig.provider,
                model: modelConfig.model,
                usage: response.usage,
                cost,
                latency,
                metadata: response.metadata
            };
        } catch (error) {
            const latency = Date.now() - startTime;

            // Track failed request
            await this.trackUsage({
                request,
                response: null,
                modelConfig: null,
                cost: { input: 0, output: 0, total: 0 },
                latency,
                status: error instanceof RateLimitError ? 'rate_limited' : 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });

            throw error;
        }
    }

    /**
     * Streaming version for real-time responses
     */
    async *stream(request: AIRequest): AsyncIterator<StreamChunk> {
        const startTime = Date.now();

        try {
            const modelConfig = this.selectModel(request);
            const provider = getProvider(modelConfig.provider);

            let totalInputTokens = 0;
            let totalOutputTokens = 0;

            for await (const chunk of provider.stream({
                model: modelConfig.model,
                messages: request.messages,
                systemPrompt: request.systemPrompt,
                temperature: request.temperature ?? modelConfig.defaultTemperature,
                maxTokens: request.maxTokens ?? modelConfig.defaultMaxTokens
            })) {
                if (chunk.usage) {
                    totalInputTokens = chunk.usage.inputTokens;
                    totalOutputTokens = chunk.usage.outputTokens;
                }

                yield {
                    delta: chunk.delta,
                    done: chunk.done,
                    usage: chunk.usage,
                    cost: chunk.done ? calculateCost(
                        modelConfig,
                        totalInputTokens,
                        totalOutputTokens
                    ) : undefined
                };
            }

            const latency = Date.now() - startTime;
            const cost = calculateCost(modelConfig, totalInputTokens, totalOutputTokens);

            // Track usage after stream completes
            await this.trackUsage({
                request,
                response: {
                    content: '',
                    usage: {
                        inputTokens: totalInputTokens,
                        outputTokens: totalOutputTokens
                    }
                },
                modelConfig,
                cost,
                latency,
                status: 'success'
            });
        } catch (error) {
            const latency = Date.now() - startTime;

            await this.trackUsage({
                request,
                response: null,
                modelConfig: null,
                cost: { input: 0, output: 0, total: 0 },
                latency,
                status: error instanceof RateLimitError ? 'rate_limited' : 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });

            throw error;
        }
    }

    /**
     * Intelligent model selection based on task requirements
     */
    private selectModel(request: AIRequest): ModelConfig {
        // User preference override - use specific provider
        if (request.preferredProvider) {
            const taskType = request.taskType;
            switch (request.preferredProvider) {
                case 'anthropic':
                    return MODEL_CONFIGS.claude_sonnet;
                case 'google':
                    return MODEL_CONFIGS.gemini_flash;
                case 'openai':
                    return taskType === 'frame_analysis' || taskType === 'video_analysis'
                        ? MODEL_CONFIGS.gpt_5_2_vision
                        : MODEL_CONFIGS.gpt_5_2;
                case 'xai':
                    if (taskType === 'thumbnail_analysis') return MODEL_CONFIGS.grok_vision;
                    if (taskType === 'code_generation') return MODEL_CONFIGS.grok_code;
                    if (taskType === 'complex_reasoning') return MODEL_CONFIGS.grok_4_1_reasoning;
                    return MODEL_CONFIGS.grok_4_1_fast;
                case 'deepseek':
                    if (taskType === 'complex_reasoning') return MODEL_CONFIGS.deepseek_reasoner;
                    return MODEL_CONFIGS.deepseek_v3;
            }
        }

        // Budget priority - route to cheapest effective model
        if (request.budgetPriority === 'cost') {
            // For cost-conscious requests, prefer Grok Fast or DeepSeek
            const taskType = request.taskType;
            if (taskType === 'conversation' || taskType === 'conversation_engaging') {
                return MODEL_CONFIGS.grok_4_1_fast; // $0.20/$0.50
            }
            if (taskType === 'complex_reasoning') {
                return MODEL_CONFIGS.deepseek_v3; // $0.27/$1.10
            }
            if (taskType === 'data_extraction' || taskType === 'summarization') {
                return MODEL_CONFIGS.gemini_flash; // $0.10/$0.40
            }
            // Default budget option
            return MODEL_CONFIGS.grok_4_1_fast;
        }

        // Multimodal requirement
        if (request.requiresMultimodal) {
            const taskType = request.taskType;
            if (taskType === 'thumbnail_analysis') {
                return MODEL_CONFIGS.grok_vision;
            }
            return taskType === 'frame_analysis' || taskType === 'video_analysis'
                ? MODEL_CONFIGS.gpt_5_2_vision
                : MODEL_CONFIGS.gemini_flash;
        }

        // Long context requirement - Grok has 2M, Gemini has 1M
        if (request.requiresLongContext) {
            return MODEL_CONFIGS.grok_4_1_fast; // 2M token context!
        }

        // Task-based selection
        return getDefaultModelForTask(request.taskType);
    }

    /**
     * Track usage in database
     */
    private async trackUsage(data: {
        request: AIRequest;
        response: any;
        modelConfig: ModelConfig | null;
        cost: { input: number; output: number; total: number };
        latency: number;
        status: 'success' | 'error' | 'timeout' | 'rate_limited';
        error?: string;
    }): Promise<void> {
        try {
            await this.supabase.from('ai_requests').insert({
                user_id: data.request.userId,
                task_type: data.request.taskType,
                provider: data.modelConfig?.provider || 'unknown',
                model: data.modelConfig?.model || 'unknown',
                input_tokens: data.response?.usage?.inputTokens || 0,
                output_tokens: data.response?.usage?.outputTokens || 0,
                cached_tokens: data.response?.usage?.cachedTokens || 0,
                input_cost: data.cost.input,
                output_cost: data.cost.output,
                total_cost: data.cost.total,
                latency_ms: data.latency,
                status: data.status,
                error_message: data.error,
                feature_context: data.request.featureContext,
                entity_type: data.request.entityType,
                entity_id: data.request.entityId,
                metadata: {}
            });
        } catch (error) {
            logger.error('Failed to track AI usage', error as Error);
            // Don't throw - tracking failure shouldn't break the request
        }
    }
}

/**
 * Singleton instance
 */
let routerInstance: AIRouter | null = null;

export function getAIRouter(): AIRouter {
    if (!routerInstance) {
        routerInstance = new AIRouter();
    }
    return routerInstance;
}
