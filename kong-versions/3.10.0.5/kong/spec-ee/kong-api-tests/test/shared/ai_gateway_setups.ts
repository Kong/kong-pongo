export const chat_typical = (model: string, settings: any) => {
  return {
    "openai": {
      target: {
        auth: {
          header_value: `Bearer ${settings.apiKey}`,
          header_name: 'Authorization',
          allow_override: false,
          azure_use_managed_identity: false,
          gcp_use_service_account: false
        },
        model: {
          name: model,
          options: {
            upstream_url: null,
            input_cost: 5,
            output_cost: 5,
            max_tokens: settings.maxTokens
          },
          provider: 'openai'
        },
        description: 'openai',
        logging: {
          log_payloads: true,
          log_statistics: true
        },
        weight: 100,
        route_type: 'llm/v1/chat'
      }
    },
    "anthropic": {
      target: {
        auth: {
          header_value: settings.apiKey,
          header_name: 'x-api-key',
          allow_override: false,
          azure_use_managed_identity: false,
          gcp_use_service_account: false
        },
        model: {
          name: model,
          options: {
            upstream_url: null,
            input_cost: 5,
            output_cost: 5,
            anthropic_version: "2023-06-01",
            max_tokens: 16000
          },
          provider: 'anthropic'
        },
        description: 'anthropic',
        logging: {
          log_payloads: true,
          log_statistics: true
        },
        weight: 100,
        route_type: 'llm/v1/chat'
      }
    },
    "azure": {
      target: {
        auth: {
          header_value: settings.apiKey,
          header_name: 'api-key',
          allow_override: false,
          azure_use_managed_identity: false,
          gcp_use_service_account: false
        },
        model: {
          name: model,
          options: {
            upstream_url: null,
            input_cost: 5,
            output_cost: 5,
            max_tokens: 32000,
            azure_api_version: "2024-10-21",
            azure_instance: "ai-gw-sdet-e2e-test",
            azure_deployment_id: "gpt-4.1-mini"
          },
          provider: 'azure'
        },
        description: 'azure',
        logging: {
          log_payloads: true,
          log_statistics: true
        },
        weight: 100,
        route_type: 'llm/v1/chat'
      }
    },
    "mistral": {
      target: {
        auth: {
          header_value: settings.apiKey,
          header_name: 'Authorization',
          allow_override: false,
          azure_use_managed_identity: false,
          gcp_use_service_account: false
        },
        model: {
          name: model,
          options: {
            upstream_url: "https://api.mistral.ai/v1/chat/completions",
            input_cost: 5,
            output_cost: 5,
            max_tokens: settings.maxTokens,
            mistral_format: "openai"
          },
          provider: 'mistral'
        },
        description: 'mistral',
        logging: {
          log_payloads: true,
          log_statistics: true
        },
        weight: 100,
        route_type: 'llm/v1/chat'
      }
    },
    "gemini": {
      target: {
        auth: {
          allow_override: false,
          azure_use_managed_identity: false,
          gcp_use_service_account: true,
          gcp_service_account_json: settings.serviceAccountJson
        },
        model: {
          name: model,
          options: {
            input_cost: 5,
            output_cost: 5,
            max_tokens: settings.maxTokens,
            anthropic_version: settings.anthropicVersion || "vertex-2023-10-16",
            gemini: {
              location_id: settings.locationId,
              api_endpoint: settings.apiEndpoint,
              project_id: settings.projectId
            }
          },
          provider: 'gemini'
        },
        description: 'gemini',
        logging: {
          log_payloads: true,
          log_statistics: true
        },
        weight: 100,
        route_type: 'llm/v1/chat'
      }
    },
    "bedrock": {
      target: {
        auth: {
          allow_override: false,
          azure_use_managed_identity: false,
          gcp_use_service_account: false,
          aws_access_key_id: settings.awsAccessKeyId || null,
          aws_secret_access_key: settings.awsSecretAccessKey || null
        },
        model: {
          name: model,
          options: {
            input_cost: 5,
            output_cost: 5,
            max_tokens: settings.maxTokens || 8192,
            bedrock: {
              aws_region: "us-east-1"
            }
          },
          provider: 'bedrock'
        },
        description: 'bedrock',
        logging: {
          log_payloads: true,
          log_statistics: true
        },
        weight: 100,
        route_type: 'llm/v1/chat'
      }
    }
  }
};
