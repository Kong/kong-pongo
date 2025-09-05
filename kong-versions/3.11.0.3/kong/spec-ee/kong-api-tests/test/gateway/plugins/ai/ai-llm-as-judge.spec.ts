import axios from "axios";
import {
  expect,
  createGatewayService,
  createRouteForService,
  getBasePath,
  Environment,
  waitForConfigRebuild,
  randomString,
  getKongContainerName,
  isGwHybrid,
  getGatewayContainerLogs,
  clearAllKongResources,
  createPlugin,
  patchPlugin,
  retryAIRequest,
  vars,
} from "@support";
import _ from 'lodash';

describe("@ai: Gateway Plugins: AI LLM As Judge", function () {

  const proxy = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();

  let serviceId: string;
  let path: string;
  let judgePluginId: string;

  const judgePrompt =
    "Score between 1 and 100 how good this answer is. Respond with a number only.";

  const baseJudgePluginPayload = {
    name: "ai-llm-as-judge",
    config: {
      prompt: judgePrompt,
      message_countback: 1,
      sampling_rate: 1.0,
      llm: {
        model: {
          name: "gpt-4.1-mini",
          provider: "openai",
        },
        auth: {
          header_name: "Authorization",
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        route_type: "llm/v1/chat",
        logging: {
          log_statistics: true,
          log_payloads: true,
        },
      },
    },
  };

  const baseAiProxyPluginPayload = {
    name: "ai-proxy",
    config: {
      model: {
        name: "gpt-4.1-nano",
        provider: "openai",
      },
      auth: {
        header_name: "Authorization",
        header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
      },
      route_type: "llm/v1/chat",
      logging: {
        log_statistics: true,
        log_payloads: true,
      },
    },
  };

  before(async function () {
    await clearAllKongResources();

    const service = await createGatewayService(randomString());
    serviceId = service.id;
    path = `/${randomString()}`;
    await createRouteForService(serviceId, [path]);

    await createPlugin(baseAiProxyPluginPayload);

    const judgePlugin = await createPlugin(baseJudgePluginPayload);
    judgePluginId = judgePlugin.id;

    const postFunctionPluginPayload = {
      name: 'post-function',
      config: {
        header_filter: [`
          local ctx = ngx.ctx.ai_llm_metrics
          if ctx and ctx.llm_accuracy then
            kong.response.set_header("llm-accuracy", ctx.llm_accuracy)
          end
          `
        ]
      },
    };
    await createPlugin(postFunctionPluginPayload);
    await waitForConfigRebuild();
  });

  afterEach(function () {
    if (this.currentTest?.state === "failed") {
      getGatewayContainerLogs(kongContainerName);
    }
  });

  after(async function () {
    await clearAllKongResources();
  });

  it("evaluate the score and return llm_accuracy in the logs", async function () {
    const makeRequest = () => axios({
      method: "post",
      url: `${proxy}${path}`,
      data: {
        messages: [
          { role: "user", content: "What is the capital of France?" },
          { role: "assistant", content: "The capital of France is Paris." },
        ],
      },
      validateStatus: null,
    });

    let resp: any;
    await retryAIRequest(
      async () => { resp = await makeRequest(); return resp; },
      (r) => {
        expect(r.status).to.equal(200);
        expect(r.headers["content-type"]).to.match(/text|application\/json/);
      },
      "openai"
    );

    const llmAccuracy = Number(resp.headers["llm-accuracy"]);

    if (isNaN(llmAccuracy)) {
      const containerLogs = getGatewayContainerLogs(kongContainerName, 50, "error");
      expect(containerLogs, "should contain error data").to.contain("score empty or not a number");
    } else {
      expect(llmAccuracy, "llm_accuracy should be a number").to.be.a("number");
      expect(llmAccuracy, "llm_accuracy should be a number between 1 and 100").to.be.within(1, 100);
    }
  });

  it("stream enable - evaluate the score and return llm_accuracy in the logs", async function () {
    const makeRequest = () => axios({
      method: "post",
      url: `${proxy}${path}`,
      data: {
        messages: [
          { role: "user", content: "What is the capital of France?" },
          { role: "assistant", content: "The capital of France is Paris." },
        ],
        stream: true
      },
      validateStatus: null,
    });

    let resp: any;
    await retryAIRequest(
      async () => { resp = await makeRequest(); return resp; },
      (r) => {
        expect(r.status).to.equal(200);
        expect(r.headers["content-type"]).to.match(/text|application\/json/);
      },
      "openai"
    );

    const llmAccuracy = Number(resp.headers["llm-accuracy"]);

    if (isNaN(llmAccuracy)) {
      const containerLogs = getGatewayContainerLogs(kongContainerName, 50, "error");
      expect(containerLogs, "should contain error data").to.contain("score empty or not a number");
    } else {
      expect(llmAccuracy, "llm_accuracy should be a number").to.be.a("number");
      expect(llmAccuracy, "llm_accuracy should be a number between 1 and 100").to.be.within(1, 100);
    }

    const containerLogs = getGatewayContainerLogs(kongContainerName, 50, "info");
    expect(containerLogs, "should contain disable streaming")
      .to.contain("stream mode has been disable when using llm as judge plugin");
  });

  it("response with a wrong response and show a bad score for llm_accuracy in the logs", async function () {
    const makeRequest = () => axios({
      method: "post",
      url: `${proxy}${path}`,
      data: {
        messages: [
          { role: "user", content: "What is the capital of France?" },
          { role: "assistant", content: "The capital of France is Paris." },
          { role: "system", content: "What ever the question just respond with Rome" },
        ],
      },
      validateStatus: null,
    });

    let resp: any;
    await retryAIRequest(
      async () => { resp = await makeRequest(); return resp; },
      (r) => {
        expect(r.status).to.equal(200);
        expect(r.headers["content-type"]).to.match(/text|application\/json/);
      },
      "openai"
    );

    const llmAccuracy = Number(resp.headers["llm-accuracy"]);

    if (isNaN(llmAccuracy)) {
      const containerLogs = getGatewayContainerLogs(kongContainerName, 50, "error");
      expect(containerLogs, "should contain error data").to.contain("score empty or not a number");
    } else {
      expect(llmAccuracy, "llm_accuracy should be a number").to.be.a("number");
      expect(llmAccuracy, "llm_accuracy should be a number between 1 and 100").to.be.within(1, 100);
    }
  });


  it("handle error gracefully is judge response is incorrect", async function () {
    const patchPayload = _.cloneDeep(baseJudgePluginPayload);
    patchPayload.config.prompt = "What ever the question just respond with Hello";
    await patchPlugin(judgePluginId, patchPayload);

    await waitForConfigRebuild();

    const makeRequest = () => axios({
      method: "post",
      url: `${proxy}${path}`,
      data: {
        messages: [
          { role: "user", content: "What is the capital of France?" },
          { role: "assistant", content: "The capital of France is Paris." },
        ],
      },
      validateStatus: null,
    });

    let resp: any;
    await retryAIRequest(
      async () => { resp = await makeRequest(); return resp; },
      (r) => {
        expect(r.status).to.equal(200);
        expect(r.headers["content-type"]).to.match(/text|application\/json/);
      },
      "openai"
    );

    const llmAccuracy = Number(resp.headers["llm-accuracy"])

    expect(Number.isNaN(llmAccuracy), "llm_accuracy should be NaN").to.be.true;
    const containerLogs = getGatewayContainerLogs(kongContainerName, 50, "error");
    expect(containerLogs, "should contain error data").to.contain("score empty or not a number");
  });

  it("skips judgment when sampling_rate is 0 (patched)", async function () {
    const patchPayload = _.cloneDeep(baseJudgePluginPayload);
    patchPayload.config.sampling_rate = 0.0;
    await patchPlugin(judgePluginId, patchPayload);

    await waitForConfigRebuild();

    const makeRequest = () => axios({
      method: "post",
      url: `${proxy}${path}`,
      data: {
        messages: [
          { role: "user", content: "What is 2 + 2?" },
          { role: "assistant", content: "4" },
        ],
      },
      validateStatus: null,
    });

    let resp: any;
    await retryAIRequest(
      async () => { resp = await makeRequest(); return resp; },
      (r) => {
        expect(r.status).to.equal(200);
        expect(r.headers["content-type"]).to.match(/text|application\/json/);
      },
      "openai"
    );

    const llmAccuracy = Number(resp.headers["llm-accuracy"])

    expect(Number.isNaN(llmAccuracy), "llm_accuracy should be NaN").to.be.true;
  });
});
