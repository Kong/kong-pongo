import { AxiosResponse } from 'axios';
import { logDebug } from '@support';
import { expect } from 'chai';
import { isLoggingEnabled } from '../utilities/logging';

/**
 * Retries an AI request with appropriate error handling for common AI API errors
 * @param makeRequest Function that makes the request and returns a Promise with the response
 * @param validateResponse Function that validates a successful response
 * @param provider Provider name for error messages (e.g., 'openai', 'azure', 'bedrock')
 * @param timeout Maximum time to retry in milliseconds
 * @param interval Time between retries in milliseconds
 * @returns The response from the successful request
 */
export const retryAIRequest = async (
  makeRequest: () => Promise<AxiosResponse<any>>,
  validateResponse: (resp: AxiosResponse<any>) => any,
  provider: any = 'unknown',
  timeout = 70000,
  interval = 5000
) => {
  const maxDelay = 30000;
  const start = Date.now();
  let attempt = 0;
  let lastError;

  while ((Date.now() - start) < timeout) {
    try {
      const resp = await makeRequest();

      if (isLoggingEnabled() && resp.status >= 400) {
        console.log(`Response from ${provider} on attempt ${attempt + 1}:`, resp.status, JSON.stringify(resp.data));
      };

      if (resp.status === 400) {
        if (resp.data?.error?.message?.includes('location is not supported')) {
          console.warn(`Received 400 response due to unsupported location for ${provider}, skipping failure`);
          return;
        }
        expect.fail(`Unexpected 400 response from ${provider}: ${resp.data?.error?.message || JSON.stringify(resp.data)}`);
      } else if (resp.status === 404) {
        const errorMsg = resp.data?.error?.message || '';
        if (errorMsg.includes('not found') || errorMsg.includes('models/gemini')) {
          console.warn(`Model not available in this environment: ${errorMsg}`);
          console.warn(`This is likely due to regional restrictions or preview model limitations.`);
          console.warn(`Skipping test for ${provider} model.`);
          return resp;
        }
        expect.fail(`Unexpected 404 response from ${provider}: ${errorMsg || JSON.stringify(resp.data)}`);
      } else if (resp.status === 504) {
        const msg = resp.data?.message || '';
        if (msg.includes('The upstream server is timing out')) {
          console.warn(`Received expected 504 timeout from ${provider}, skipping failure`);
          return;
        }
        expect.fail(`Unexpected 504 response from ${provider}: ${msg || 'no message'}`);
      } else if (resp.status === 429 || resp.status === 529) {
        console.error(`Rate limit exceeded for ${provider} provider`);
        throw new Error(`Rate limit exceeded: ${resp.status}`);
      } else if (resp.status === 200 || resp.status === 201) {
        return validateResponse(resp);
      } else {
        expect.fail(`Unexpected response status from ${provider}: ${resp.status}`);
      }
    } catch (err) {
      lastError = err;
      if(process.env.AI_TESTS_FAIL_FAST === 'true') {
        break;
      }
      attempt++;
      // Exponential backoff with jitter
      const delay = Math.min(interval * Math.pow(2, attempt), maxDelay) + Math.floor(Math.random() * 1000);
      if ((Date.now() - start + delay) > timeout) break;
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastError || new Error('AI request timed out');
};

/**
 * Validates response from AI provider APIs
 * @param resp The response object from the API call
 * @param expectedProvider Provider name (e.g., 'openai', 'anthropic', 'vertex')
 * @param expectedModel Expected model name
 * @param type Response type ('chat', 'completions', 'image_generation')
 */
export const evaluateAIResponseStructure = (resp: any, expectedProvider: string, expectedModel?: string | null, type = 'chat', model_name_header = true) => {
  expect(resp.status, 'Response should have status code 200').to.equal(200);
  // Check if the provider and skip id property validation if necessary
  const isAnthropic = expectedProvider === 'anthropic';
  const isVertex = expectedProvider === 'vertex';
  const isGemini = expectedProvider === 'gemini';
  const isBedrock = expectedProvider === 'bedrock';

  // vertex and gemini use 'gemini' as the provider name
  const providerName = expectedProvider === 'vertex' ? 'gemini' : expectedProvider;

  // Universal fields for all providers
  if (type !== 'image_generation') {
    expect(resp.data, 'Response should have model property').to.have.property('model');
    expect(resp.data.model, 'Response should have expected model').to.contain(expectedModel);
    expect(resp.data, 'Response should have choices property').to.have.property('choices');
    // Usage field assertions (existence and > 1)
    expect(resp.data, 'Response should have usage property').to.have.property('usage');
    const usage = resp.data.usage;
    expect(usage, 'Usage should have prompt_tokens').to.have.property('prompt_tokens');
    expect(usage, 'Usage should have completion_tokens').to.have.property('completion_tokens');
    expect(usage, 'Usage should have total_tokens').to.have.property('total_tokens');
    expect(usage.prompt_tokens, 'prompt_tokens should be > 1').to.be.a('number').and.to.be.greaterThan(1);
    expect(usage.completion_tokens, 'completion_tokens should be > 1').to.be.a('number').and.to.be.greaterThan(1);
    expect(usage.total_tokens, 'total_tokens should be > 1').to.be.a('number').and.to.be.greaterThan(1);
  }

  if (!isAnthropic && !isVertex && !isGemini && !isBedrock && type !== 'image_generation') {
    expect(resp.data, 'Response should have id property').to.have.property('id');
  }

  switch (type) {
    case 'chat':
      expect(resp.data.choices[0], 'Response should have message property').to.have.property('message');
      expect(resp.data.choices[0].message, 'Response should have role property').to.have.property('role');
      expect(resp.data.choices[0].message, 'Response should have content property').to.have.property('content');
      break;
    case 'completions':
      expect(Object.keys(resp.data.choices[0])).to.include.oneOf(['text', 'message']);
      break;
    case 'image_generation':
      logDebug(resp.data.data)
      expect(resp.data, 'Response should have data property').to.have.property('data');
      expect(resp.data.data[0], 'Response data should have url property').to.have.property('url');
      expect(resp.data.data[0].url, 'Url should contain image link').to.contain('png');
      break;
  }

  if (model_name_header === true) {
    //assumes that model_name_header is true
    expect(resp.headers, 'Response should have x-kong-llm-model header').to.have.property('x-kong-llm-model');
    expect(resp.headers['x-kong-llm-model'], 'Response header should have expected model and provider').to.contain(expectedModel).and.to.contain(providerName);
  } else {
    expect(resp.headers, 'Response should not have x-kong-llm-model header').to.not.have.property('x-kong-llm-model')
  }
}
