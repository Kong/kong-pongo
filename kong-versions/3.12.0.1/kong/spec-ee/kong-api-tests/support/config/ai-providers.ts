import { vars } from './gateway-vars';

interface ModelConfig {
  model: string | null;
  options?: Record<string, any> | null;
  route_type?: string;
}

interface AuthConfig {
  allow_override: boolean;
  aws_access_key_id: string | null;
  aws_secret_access_key: string | null;
  azure_client_secret: string | null;
  azure_tenant_id: string | null;
  azure_use_managed_identity: boolean;
  gcp_service_account_json: string | null;
  gcp_use_service_account: boolean;
  header_name: string | null;
  header_value: string | null;
  param_location: string | null;
  param_name: string | null;
  param_value: string | null;
}

interface AIProvider {
  id: string;
  name: string;
  variant: string;
  auth: AuthConfig;
  chat: ModelConfig;
  completions: ModelConfig;
  embeddings: ModelConfig;
  image: ModelConfig;
  image_generation: ModelConfig;
  audio: ModelConfig;
  realtime: ModelConfig;
  batches: ModelConfig;
  files: ModelConfig;
  response: ModelConfig;
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  model: null,
  options: null,
};

const DEFAULT_AUTH_BASE: Partial<AuthConfig> = {
  allow_override: false,
  aws_access_key_id: null,
  aws_secret_access_key: null,
  azure_client_secret: null,
  azure_tenant_id: null,
  azure_use_managed_identity: false,
  gcp_service_account_json: null,
  gcp_use_service_account: false,
  param_location: null,
  param_name: null,
  param_value: null,
};

// Helper functions for creating configurations
const createHeaderAuth = (headerName: string, headerValue: string): AuthConfig =>
  ({
    ...DEFAULT_AUTH_BASE,
    header_name: headerName,
    header_value: headerValue,
  } as AuthConfig);

const createParamAuth = (paramName: string, paramValue: string, location = 'query'): AuthConfig =>
  ({
    ...DEFAULT_AUTH_BASE,
    param_location: location,
    param_name: paramName,
    param_value: paramValue,
  } as AuthConfig);

const createGCPAuth = (serviceAccountJson: string): AuthConfig =>
  ({
    ...DEFAULT_AUTH_BASE,
    gcp_service_account_json: serviceAccountJson,
    gcp_use_service_account: true,
  } as AuthConfig);

const createAWSAuth = (accessKeyId: string, secretAccessKey: string): AuthConfig =>
  ({
    ...DEFAULT_AUTH_BASE,
    aws_access_key_id: accessKeyId,
    aws_secret_access_key: secretAccessKey,
  } as AuthConfig);

const createModelConfig = (model: string | null, options?: Record<string, any>): ModelConfig => ({
  model,
  options: options || null,
});

// Provider configurations
export const providers: AIProvider[] = [
  // OpenAI - Full feature support
  {
    id: 'openai',
    name: 'openai',
    variant: 'openai',
    chat: createModelConfig('gpt-4'),
    completions: createModelConfig('gpt-3.5-turbo-instruct'),
    embeddings: createModelConfig(
      'text-embedding-3-small',
      {
        input_cost: 100,
        output_cost: 100,
      },
    ),
    image: createModelConfig('gpt-4o-mini'),
    image_generation: createModelConfig('dall-e-2'),
    audio: createModelConfig('whisper-1'),
    auth: createHeaderAuth('Authorization', `Bearer ${vars.ai_providers.OPENAI_API_KEY}`),
    realtime: createModelConfig('gpt-4o-realtime-preview'),
    batches: createModelConfig('gpt-4o'),
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // Mistral - Chat and image support
  {
    id: 'mistral',
    name: 'mistral',
    variant: 'mistral',
    chat: createModelConfig('mistral-medium-latest', {
      mistral_format: 'openai',
      upstream_url: 'https://api.mistral.ai/v1/chat/completions',
    }),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: createModelConfig(
      'mistral-embed',
      {
        mistral_format: 'openai',
      },
    ),
    image: createModelConfig('pixtral-12b-2409', {
      mistral_format: 'openai',
      upstream_url: 'https://api.mistral.ai/v1/img/completions',
    }),
    image_generation: DEFAULT_MODEL_CONFIG,
    audio: DEFAULT_MODEL_CONFIG,
    auth: createHeaderAuth('Authorization', `Bearer ${vars.ai_providers.MISTRAL_API_KEY}`),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  {
    id: 'anthropic',
    name: 'anthropic',
    variant: 'anthropic',
    chat: createModelConfig('claude-3-5-haiku-20241022', {
      anthropic_version: '2023-06-01',
      max_tokens: 256,
    }),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: DEFAULT_MODEL_CONFIG,
    image: DEFAULT_MODEL_CONFIG,
    image_generation: DEFAULT_MODEL_CONFIG,
    audio: DEFAULT_MODEL_CONFIG,
    auth: createHeaderAuth('x-api-key', vars.ai_providers.ANTHROPIC_API_KEY ?? ''),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // GCP Vertex AI - on GCP infrastructure
  {
    id: 'gemini-vertex-1',
    name: 'gemini',
    variant: 'vertex',
    chat: createModelConfig('gemini-2.0-flash', {
      gemini: {
        location_id: 'us-central1',
        api_endpoint: 'us-central1-aiplatform.googleapis.com',
        project_id: 'gcp-sdet-test',
      },
    }),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: createModelConfig('text-embedding-004'),
    image: DEFAULT_MODEL_CONFIG,
    image_generation: createModelConfig('gemini-2.5-flash-image'),
    audio: DEFAULT_MODEL_CONFIG,
    auth: createGCPAuth(vars.ai_providers.VERTEX_API_KEY ?? ''),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // GCP Vertex AI - Llama with upstream URL
  {
    id: 'gemini-vertex-2',
    name: 'gemini',
    variant: 'vertex',
    chat: createModelConfig('meta-llama/Llama-3.1-8B-Instruct', {
      upstream_url:
        'https://us-central1-aiplatform.googleapis.com/v1/projects/432057123508/locations/us-central1/endpoints/9006006284624855040/chat/completions',
    }),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: DEFAULT_MODEL_CONFIG,
    image: DEFAULT_MODEL_CONFIG,
    image_generation: DEFAULT_MODEL_CONFIG,
    audio: DEFAULT_MODEL_CONFIG,
    auth: createGCPAuth(vars.ai_providers.VERTEX_API_KEY ?? ''),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // GCP Vertex AI - Llama with endpoint ID
  {
    id: 'gemini-vertex-3',
    name: 'gemini',
    variant: 'vertex',
    chat: createModelConfig('meta-llama/Llama-3.1-8B-Instruct', {
      gemini: {
        location_id: 'us-central1',
        api_endpoint: 'us-central1-aiplatform.googleapis.com',
        project_id: 'gcp-sdet-test',
        endpoint_id: '9006006284624855040',
      },
    }),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: DEFAULT_MODEL_CONFIG,
    image: DEFAULT_MODEL_CONFIG,
    image_generation: DEFAULT_MODEL_CONFIG,
    audio: DEFAULT_MODEL_CONFIG,
    auth: createGCPAuth(vars.ai_providers.VERTEX_API_KEY ?? ''),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // Google Gemini Public API
  {
    id: 'gemini-public',
    name: 'gemini',
    variant: 'gemini',
    chat: createModelConfig('gemini-2.0-flash'),
    completions: createModelConfig('gemini-2.5-flash-image'),
    embeddings: createModelConfig('text-embedding-004'),
    image: DEFAULT_MODEL_CONFIG,
    image_generation: DEFAULT_MODEL_CONFIG,
    audio: DEFAULT_MODEL_CONFIG,
    auth: createParamAuth('key', vars.ai_providers.GEMINI_API_KEY ?? ''),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // Azure OpenAI
  {
    id: 'azure',
    name: 'azure',
    variant: 'azure',
    chat: createModelConfig('gpt-4.1-mini', {
      azure_instance: 'ai-gw-sdet-e2e-test',
      azure_deployment_id: 'gpt-4.1-mini',
      max_tokens: 256,
      azure_api_version: '2024-10-21',
    }),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: createModelConfig('text-embedding-3-small'),
    image: DEFAULT_MODEL_CONFIG,
    image_generation: DEFAULT_MODEL_CONFIG,
    audio: DEFAULT_MODEL_CONFIG,
    auth: createHeaderAuth('api-key', vars.ai_providers.AZUREAI_API_KEY ?? ''),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // AWS Bedrock
  {
    id: 'bedrock',
    name: 'bedrock',
    variant: 'bedrock',
    chat: createModelConfig('anthropic.claude-3-haiku-20240307-v1:0', {
      bedrock: {
        aws_region: 'ap-northeast-1',
      },
    }),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: createModelConfig('amazon.titan-embed-text-v2:0'),
    image: DEFAULT_MODEL_CONFIG,
    image_generation: createModelConfig('amazon.titan-image-generator-v1'),
    audio: DEFAULT_MODEL_CONFIG,
    auth: createAWSAuth(vars.aws.AWS_ACCESS_KEY_ID ?? '', vars.aws.AWS_SECRET_ACCESS_KEY ?? ''),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },

  // Hugging Face
  {
    id: 'huggingface',
    name: 'huggingface',
    variant: 'huggingface',
    chat: createModelConfig('meta-llama/Meta-Llama-3-8B-Instruct'),
    completions: DEFAULT_MODEL_CONFIG,
    embeddings: createModelConfig('sentence-transformers/all-MiniLM-L6-v2'),
    image: DEFAULT_MODEL_CONFIG,
    image_generation: DEFAULT_MODEL_CONFIG,
    audio: DEFAULT_MODEL_CONFIG,
    auth: createHeaderAuth('Authorization', `Bearer ${vars.ai_providers.HUGGINGFACE_API_KEY}`),
    realtime: DEFAULT_MODEL_CONFIG,
    batches: DEFAULT_MODEL_CONFIG,
    files: DEFAULT_MODEL_CONFIG,
    response: DEFAULT_MODEL_CONFIG
  },
];

// Helper functions for finding providers
export const getProviderById = (id: string): AIProvider | undefined => {
  return providers.find(provider => provider.id === id);
};

export const getProvidersByVariant = (variant: string): AIProvider[] => {
  return providers.filter(provider => provider.variant === variant);
};

export const getProvidersByName = (name: string): AIProvider[] => {
  return providers.filter(provider => provider.name === name);
};

export const getProvidersWithType = (
  modelType: keyof Pick<AIProvider, 'chat' | 'completions' | 'embeddings' | 'image' | 'image_generation' | 'audio' | 'realtime' | 'batches' | 'files' | 'response'>,
): AIProvider[] => {
  return providers.filter(provider => provider[modelType].model !== null);
};

// Provider IDs constants for easy reference
export const PROVIDER_IDS = {
  OPENAI: 'openai',
  MISTRAL: 'mistral',
  ANTHROPIC: 'anthropic',
  GEMINI_VERTEX_1: 'gemini-vertex-1',
  GEMINI_VERTEX_2: 'gemini-vertex-2',
  GEMINI_VERTEX_3: 'gemini-vertex-3',
  GEMINI_PUBLIC: 'gemini-public',
  AZURE: 'azure',
  BEDROCK: 'bedrock',
  HUGGINGFACE: 'huggingface',
} as const;

export type { AIProvider, ModelConfig, AuthConfig };
