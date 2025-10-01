# KONG API TESTS

[![Gateway API Tests](https://github.com/Kong/kong-ee/actions/workflows/gateway-api-tests.yml/badge.svg)](https://github.com/Kong/kong-ee/actions/workflows/gateway-api-tests.yml)

> Note: This repo is in active development.

The `spec-ee/kong-api-tests` is aimed to be used to create and execute Kong Gateway API tests locally as well as in CI.

### How to Build

1. Navigate to `spec-ee/kong-api-tests`
2. Install `node` & `npm` (you can also use [nvm](https://github.com/nvm-sh/nvm)) (minimum node.js version `v16.x.x`)
3. Access private NPM packages
   - Copy `.npmrc.ci` file contents into `.npmrc`
     - `cp .npmrc.ci .npmrc`
   - Export the `NPM_TOKEN` in your terminal
     - `export NPM_TOKEN=`[NPM Read Token](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&h=team-kong.1password.com&i=ss3ux3i3brfsruiarhhugzlqqm&v=q7r4hh4465zentymwtoonxxp3m)
4. For formatting/linting, run `npm run format` and then `npm run lint`
5. Install the dependency packages with the following command `npm install --legacy-peer-deps`

## Gateway

**Deploying Gateway**

We use [gateway-docker-compose-generator](https://github.com/Kong/gateway-docker-compose-generator) to deploy gateway for API tests.\
In CI, the gateway starts `without enterprise license`. The license is being posted via API at the runtime before all tests to allow us to have more control over the license.

### Env File

Create a `.env` file in the root directory.

Make sure to have `KONG_LICENSE_DATA` environment variable set in your environment.

Copy from the [.env.example](https://github.com/Kong/kong-api-tests/blob/contrib/readme-update/.env.example.gateway) file.

Add the following gateway specific environment variable to your `.env` file.

TEST_APP=gateway

**Environment Secrets**

Retrieve the necessary credentials from _1Password_ and add as environment variables in your .env file:

- [AWS Secret Credentials](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=3o5zhzexnfhyldid53j6fquvwm&h=team-kong.1password.com) - required only for `aws-lambda-secret-reference` test

  `AWS_ACCESS_KEY_ID="<aws_access_key_id>"`

  `AWS_SECRET_ACCESS_KEY="<aws_secret_access_key>"`

- [AWS Cognito Credentials](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=64lga2jcrnwelmnwkz7eyk3rpu&h=my.1password.com) - required only for `oidc-aws-azure` test

  `AWS_COGNITO_CLIENT_SECRET="<aws_cognito_client_secret>"`

- [Azure AD Credentials](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=riohgjuoxwknwm7bmtoyms4zpu&h=my.1password.com) - required only for `oidc-aws-azure` test

  `AZURE_AD_CLIENT_SECRET="<azure_ad_client_secret>"`

**Test specific environment variable requirements for Gateway**

There are tests which rely on specific gateway environment variables, make sure to include these in your gateway/kong/docker.

- `aws-lambda-secret-reference` test

  `AWS_REGION="us-east-2"`

  `AWS_ACCESS_KEY_ID="<aws_access_key_id>"`

  `AWS_SECRET_ACCESS_KEY="<aws_secret_access_key>"`

  [GCP_SERVICE_ACCOUNT](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=w2gvxcep5ffevmiykbfq4ffb64&h=team-kong.1password.com)`="<gcp_service_account_key>"`

- `azure-functions-secret-reference` test

  [AZURE_FUNCTION_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=e7vip43g3nucwsrb44ijs6qsfa&h=team-kong.1password.com)`="<azure_function_key>"`

- `app-dynamics` test
  [APPD_PASSWORD](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=syw6avr7bddbconfzep6o6jokq&h=team-kong.1password.com) `="<appd_password>"`

- `rla-secret-referene` test

  `RLA_REDISU=redisuser`

  `RLA_REDISP=redispassword`

  `AWS_REGION="us-east-2"`

  `AWS_ACCESS_KEY_ID="<aws_access_key_id>"`

  `AWS_SECRET_ACCESS_KEY="<aws_secret_access_key>"`

- `redis-partial-ee` test

  `RLA_REDISU=redisuser`

  `RLA_REDISP=redispassword`

- `dbless-config-sync` test

  `READ_ONLY=true`

  `GW_MODE=db-less`  

- `ai-proxy` test

  `AWS_ACCESS_KEY_ID="<aws_access_key_id>"`

  `AWS_SECRET_ACCESS_KEY="<aws_secret_access_key>"`  

  [GCP_SERVICE_ACCOUNT](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=w2gvxcep5ffevmiykbfq4ffb64&h=team-kong.1password.com)`="<gcp_service_account_key>"`

  [OPENAI_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=fd4xnv2bicwnmyrcsqb2zgt3we&h=team-kong.1password.com) `="<openai_api_key>"`

  [MISTRAL_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=mdudxendyicvmcz5qgca4jhqoa&h=team-kong.1password.com) `="<mistral_api_key>"`

  [ANTHROPIC_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=773qe6hrfullabfba3jhiywvba&h=team-kong.1password.com) `="<ANTHROPIC_API_KEY>"`

  [VERTEX_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=qdjvcu44u726zd4isu3xtpmnvi&h=team-kong.1password.com) `="<VERTEX_API_KEY>"`

  [GEMINI_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=qwzcuyyodzetqyreb2dls6fnqe&h=team-kong.1password.com) `="<GEMINI_API_KEY>"`

  [AZUREAI_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=uyi7ym44hn36t7pcnq7hcmmrxm&h=team-kong.1password.com) `="<AZUREAI_API_KEY>"`

- `certificates` test

  `AWS_REGION="us-east-2"`

  `AWS_ACCESS_KEY_ID="<aws_access_key_id>"`

  `AWS_SECRET_ACCESS_KEY="<aws_secret_access_key>"`

- `datadog` test

  [DATADOG_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=5p74qvp7vqcbnnylovyiqifh4i&h=team-kong.1password.com)

- `confluent` and `confluent-consume` tests

  [CONFLUENT_CLUSTER_API_KEY](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=troauac327rttd6idzw54lwa7q&h=team-kong.1password.com) `="<sdet-cluster-api-key>"`

  [CONFLUENT_CLUSTER_API_SECRET](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=troauac327rttd6idzw54lwa7q&h=team-kong.1password.com) `="<sdet-cluster-api-secret>"`

## Test specific 3rd party service requirements for Gateway

There are specific tests which rely on particular 3rd party services to run alongside the gateway.\
Make sure to enable these services using [gateway-docker-compose-generator](https://eu.api.konghq.com/konnect-api)

- All tests relying in upstream service or sending requests to upstream use [httpbin-service](https://github.com/Kong/gateway-docker-compose-generator/blob/ce44aa5d508b7210336a58975285ea8e2e6b6bee/docker-compose.yml.sh#L211) which needs to run in the same docker network as kong. 
- `1_vitals-influxdb` test requires [INFLUXDB](https://github.com/Kong/gateway-docker-compose-generator/blob/d9ee692675d4efdb14d0e1b8376b20a290f72b34/docker-compose.yml.sh#L32)
- `aws-lambda-secret-reference` and `rla-secret-reference` tests require [HCV](https://github.com/Kong/gateway-docker-compose-generator/blob/d9ee692675d4efdb14d0e1b8376b20a290f72b34/docker-compose.yml.sh#L40)
- `opentelemetry` test requires [JAEGER](https://github.com/Kong/gateway-docker-compose-generator/blob/d9ee692675d4efdb14d0e1b8376b20a290f72b34/docker-compose.yml.sh#L54)
- `otel-logs` test requires [opentelemetry-collector](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L108)
- `rate-limiting-advanced` test requires [REDIS (standalone)](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L86)
- `rla-namespace` test requires [REDIS (standalone)](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L86)
- `redis-partial-ee` test requires [REDIS (standalone, cluster and sentinel)](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L86)
- `dbless-config-sync` test requires [REDIS (standalone)](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L86)
- `deck-redis-config.spec` test requires [REDIS (standalone)](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L86)
- `oas-validation` test requires [SWAGGER](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L36)
- `acme` test requires [Pebble](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L1022) which will be automatically enabled when [ACME](https://github.com/Kong/gateway-docker-compose-generator/blob/main/docker-compose.yml.sh#L126) is set to `true`
- `http-log` test requires [SPLUNK](https://github.com/Kong/gateway-docker-compose-generator/blob/5fe63e2753722bed90a6341dee5960303c82f965/docker-compose.yml.sh#L133)
- `request-callout` test still requires [SQUID](https://github.com/Kong/gateway-docker-compose-generator/blob/5fe63e2753722bed90a6341dee5960303c82f965/docker-compose.yml.sh#L95), [CADDY](https://github.com/Kong/gateway-docker-compose-generator/blob/5fe63e2753722bed90a6341dee5960303c82f965/docker-compose.yml.sh#L141) and [TEST_DATA_VAULT](https://github.com/Kong/gateway-docker-compose-generator/blob/5fe63e2753722bed90a6341dee5960303c82f965/docker-compose.yml.sh#L140).
- `datadog` test required [DATADOG](https://github.com/Kong/gateway-docker-compose-generator/blob/ea914d4490731989fe998e3034d970d071093934/docker-compose.yml.sh#L1276)

**Test specific configuration requirements for Gateway**

- `licenses` test requires the gateway to NOT have enterprise license. We `post` the enterprise license at the runtime via API before tests start to run.\
  There will be no harm having the license in kong, the tests will still pass but in order to fully imitate the CI environment you need to set `CI=true` and exclude license from kong locally.

- `ACME` plugin tests require `127.0.0.1 domain.test` mappping to exist in your `/etc/hosts` file.

- `dp-resilience` test requires `4` DPs (note: this test only runs in hybrid mode)[Learn More](https://docs.konghq.com/gateway/latest/kong-enterprise/cp-outage-handling/), so the test would generate additional dp configurations and attach it to the `docker-compose.yml` with `yq` command. You also need to export those env variables during your test run [GCP_SERVICE_ACCOUNT](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=5pl4itslluom5ochvfulebjs6m&i=z3chsqnxgtucpkgspdyonwfxvm&h=team-kong.1password.com), `KONG_VERSION`(note: required to compose the folder path for GCP cloud storage), `TF_VAR_kong_license_data`(note: only in GKE setup), `UNIX_TIMESTAMP`(note: only in GKE setup)

- `jwt-singer` tests use a JWT token signed with the `jwt-singer-token-key-pair` public/private key pair, which is stored in the `credential.json` file. The corresponding public key is also available in [jwt-singer-token-public-key](https://github.com/Kong/gateway-docker-compose-generator/blob/main/json-server/jwk.json).

**Gateway Mode**

The default Gateway mode is `classic`. If you want to run tests against `hybrid` mode specify that in your `.env` file:

```bash
# .env file
GW_MODE=hybrid
```

If you want to run tests against **Kong OSS**, make sure to set `IS_KONG_OSS=true` in your `.env` file or in the GH workflow that you trigger.
If you want to write or run tests against **db-less** mode, make sure to 
- set `GW_MODE=db-less` and `READ_ONLY=true` before generating docker-compose.yml file.
- include `dbless` in the file name of your script, such as `dbless-config-sync`, github workflow will filtering test using `dbless`.

### Verbose Response Logging

`export VERBOSE_RESPONSE_LOGS=false` to disable response logging (default is `true`).

**Execute Gateway API Test Suites**

- All existing gateway test

```bash
npm run test-gateway
```

- A single gateway test

```bash
# for example if you want to run 'service.spec.ts' tests
npm run test-spec --spec=service
```

- Smoke tests

```bash
npm run test-smoke
```

- Kong OSS tests

```bash
npm run test-oss
```

- Release package tests

Make sure to have `KONG_VERSION` and `KONG_PACKAGE` variables set in your environment.\
For example, `export KONG_PACKAGE=ubuntu-22.04 KONG_VERSION=3.3.0.0` or in your `.env` file

**When `KONG_PACKAGE` environment variable is set in your environment the framework will automatically\
understand that api tests should run against natively installed kong (download kong from pulp and install).**
After this, you can run the tests as mentioned above.

Refer to [How to run API smoke tests](https://konghq.atlassian.net/wiki/spaces/FTT/pages/3072917606/Running+smoke+tests+on+released+artifacts) to learn about running the tests in GH Actions.

### Mocking/Recording

The framework uses [POLLY.JS](https://netflix.github.io/pollyjs/#/quick-start) JavaScript library to record the target request/response interactions.

Example usage:

```bash
# import the 'createPolly' function at the top level of the test file
import { createPolly } from '@support'

# instantiate a new Polly instance for mocking/recording
const polly = createPolly('yourRecordingName')

# send a request
await axios('http://localhost:8000/someRequest')

# stop the polly mock instance to stop recording further requests
await polly.stop()
```

In the above example polly will record the request/response interraction and replay it using the response recording when the test is run again thereafter.\
The recorded files/mocks will be stored for the specified amount of time (e.g. 30 days).

## Koko & Konnect

### Env File

Add the following konnect specific environment variables to your `.env` file.

1. TEST_APP=koko
2. TEST_ENV=dev
3. KONNECT_USER_PASSWORD=[KONNECT_USER_PASSWORD](https://start.1password.com/open/i?a=KJVYOL2OTVGRPAAAHEVOL6MXZE&v=q7r4hh4465zentymwtoonxxp3m&i=vag6ska5nafl3u7rlxy26wobge&h=team-kong.1password.com)
4. KONNECT_DP_IMAGE=`yourTargetDockerImage` - optional, default is kong/kong-gateway-dev:nightly-ubuntu

**Execute Konnect Tests**

- All existing tests

```bash
npm run test-koko
```
- A single test

```bash
# for example if you want to run 'service.spec.ts' tests
npm run test-spec --spec=service
```

## Run tests in GKE Cluster

### Run from local setup
Follow the [instructions](https://github.com/Kong/gateway-docker-compose-generator/tree/main/infrastructure/gateway-terraform-gke) to deploy the Kong gateway hybrid mode in GKE cluster.

After deployment, try portforward `kong-cp`, `kong-dp`, and `redis` pod to your localhost. Before we run any api tests, aside from regular env variables you set before running the tests (e.g. `TEST_APP`,`AWS_ACCESS_KEY_ID`), there are some extra env variables you need to set.
```
 export GKE=true
 export GW_MODE=hybrid
 export HCV=false
 export GW_HOST=localhost
 ```

 We added `tag` like `@gke` to filter through tests that can run against kong deployed in GKE cluster, you can run command below to trigger the e2e api tests.

- All existing tests with `@gke` tag

```bash
npm run test-gke
```
- A single test

```bash
export TEST_APP=gateway
# for example if you want to run 'service.spec.ts' tests
npm run test-spec --spec=service
```

### Run from github action workflow

You can also trigger the test run from [github Actions workflow](https://github.com/Kong/kong-ee/actions/workflows/gateway-cluster-api-tests.yml). This workflow will conduct all the actions required for running kong e2e api tests against kong deployed in GKE cluster including: 

1. Create/provision the GKE Cluster using `terraform`
2. Deploy Kong gateway hybrid mode to the GKE Cluster using `terraform`
3. Portforwarding `kong cp`, `kong dp`, and `redis` pod to github runner localhost
4. Run the e2e api tests
5. Send results to slack
6. Destroy the GKE cluster using `terraform`

There are a couple workflow input variables you need to pay attention when you run the workflow. Usually we bring up kong with images like `kong/kong-gateway-dev:nightly-ubuntu` (⚠️ `kong/kong-gateway-internal` seems not compatible with `k8s`/`terraform`) or `kong/kong-gateway:3.6.0.0`. So we breakdown the `image` to `kong/kong-gateway-dev` as the input for `Kong repository to test`, and `nightly-ubuntu` for `Kong version to test`. We also need to specify the [`Kong effective Semver`](https://github.com/Kong/charts/blob/main/charts/kong/values.yaml#L139) to value like `3.7.0.0` if you are using a non-released version of kong image like `nightly-ubuntu`.