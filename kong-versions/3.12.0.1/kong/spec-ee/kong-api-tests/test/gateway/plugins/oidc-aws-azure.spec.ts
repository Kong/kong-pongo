import axios from 'axios';
import crypto from 'crypto';
import {
    expect,
    Environment,
    getBasePath,
    createGatewayService,
    createRouteForService,
    logResponse,
    isGateway,
    eventually,
    createPlugin,
    getGatewayContainerLogs,
    findRegex,
    isGwHybrid,
    getKongContainerName,
    randomString,
    deletePlugin,
    deleteGatewayRoute,
    deleteGatewayService,
    vars,
    checkGwVars,
    Consumer,
    createConsumer,
    deleteConsumer,
    clearAllKongResources
} from '@support';
import querystring from 'querystring'


// ********* Note *********
// In order for this test file to successfully run you need to have defined the following environment variables
// AWS_COGNITO_CLIENT_SECRET: ${{actualAWSCognitoSecret}}
// AZURE_AD_CLIENT_SECRET: ${{actualAzureADSecret}}
// ********* End **********

describe('Gateway Plugins: OIDC with AWS Cognito', function () {
    const url = `${getBasePath({ environment: isGateway() ? Environment.gateway.admin : undefined })}/plugins`;
    const proxyUrl = `${getBasePath({ app: 'gateway', environment: Environment.gateway.proxy })}`;
    const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
    const pathUsedInCognito = '/path1';
    let basePayload: object;
    let accessToken: string;
    let serviceId: string;
    let routeId: string;
    let pluginId: string;
    const cognito = {
        username: 'gateway-test@konghq.com',
        password: 'GoodPassword1!',
        client_id: '24pd8bpjiecd3f0vlukepjvg56',
        client_secret: vars.cognito.AWS_COGNITO_CLIENT_SECRET,
        issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_3BJcKDk6U/.well-known/openid-configuration'
    };

    /**
     * Generate Cognito secret hash using HMAC-SHA256 and base64 encoding.
     *
     * @param {string} username - Cognito username.
     * @param {string} clientId - Cognito App Client ID.
     * @param {string} clientSecret - Cognito App Client Secret.
     * @returns {string} - Base64-encoded HMAC-SHA256 digest.
     */
    function generateSecretHash(username: string, clientId: string, clientSecret: any): string {
        const message = username + clientId;
        const hmac = crypto.createHmac('sha256', clientSecret);
        hmac.update(message);
        const digest = hmac.digest('base64');
        return digest;
    };

    /**
     * Authenticate with AWS Cognito using USER_PASSWORD_AUTH flow
     * @param {Object} auth - Object containing Cognito auth parameters
     * @returns {Promise<Object>} - Response from Cognito
     */
    interface CognitoAuth {
        username: string;
        password: string;
        client_id: string;
        secret_hash: string;
    }
    async function authenticateWithCognito(auth: CognitoAuth): Promise<any> {
        try {
            const response = await axios({
                method: 'post',
                url: 'https://cognito-idp.us-east-2.amazonaws.com',
                validateStatus: null,
                headers: {
                    'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
                    'Content-Type': 'application/x-amz-json-1.1',
                },
                data: {
                    AuthFlow: 'USER_PASSWORD_AUTH',
                    AuthParameters: {
                        USERNAME: auth.username,
                        PASSWORD: auth.password,
                        SECRET_HASH: auth.secret_hash,
                    },
                    ClientId: auth.client_id,
                },
            });

            return response;
        } catch (error) {
            console.error('Cognito auth request failed:', error);
            throw error;
        }
    }

    before(async function () {
        checkGwVars('cognito');
        const service = await createGatewayService(randomString());
        serviceId = service.id;
        const route = await createRouteForService(serviceId, [pathUsedInCognito]);
        routeId = route.id;
        basePayload = {
            name: "openid-connect",
            service: {
                id: serviceId
            },
            config: {
                issuer: cognito.issuer,
                auth_methods: ["authorization_code", 'bearer'] // 'authorization_code' flow redirects user to login page; 'bearer' requires a valid access token
            }
        };
    })

    it('should create the plugin with a valid issuer only', async function () {
        const resp = await createPlugin(basePayload);
        pluginId = resp.id;
    })

    it('should return 500 when configuring only a valid issuer', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInCognito}`,
                validateStatus: null
            });
            logResponse(resp);
            const currentLogs = getGatewayContainerLogs(kongContainerName, 20);
            const isLogFound = findRegex('client id was not specified', currentLogs);
            expect(
                isLogFound,
                'Should see logs for the test case'
            ).to.be.true;
            expect(resp.status, 'Status should be 500').to.equal(500);
            expect(resp.data.message, 'Body.message should be correct').to.equal('An unexpected error occurred');
        });
    })

    it('should patch the plugin with invalid client secret', async function () {
        const pluginPayload = {
            config: {
                client_id: [cognito.client_id],
                client_secret: ['invalid_client_secret']
            }
        };
        const resp = await axios({ method: 'patch', url: `${url}/${pluginId}`, data: pluginPayload });
        logResponse(resp);
        expect(resp.status, `Status should be 200`).to.equal(200);
    })

    it('should return 302 when configuring an invalid client secret', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInCognito}`,
                validateStatus: null,
                maxRedirects: 0 // To avoid redirecting
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 302').to.equal(302);
            expect(resp.headers.location, 'Headers.Location should be correct').to.include('https://us-east-23bjckdk6u.auth.us-east-2.amazoncognito.com/oauth2/authorize');
        });
    })

    it('should fail to sign in when configuring an invalid client secret', async function () {
        const secretHash = generateSecretHash(cognito.username, cognito.client_id, 'invalid_client_secret');
        await eventually(async () => {
            const auth = {
                username: cognito.username,
                password: cognito.password,
                client_id: cognito.client_id,
                secret_hash: secretHash
            };
            const resp = await authenticateWithCognito(auth);
            logResponse(resp);
            expect(resp.status, 'Status should be 400').to.equal(400);
            expect(resp.data.message, 'Body.message should include expected text').to.include('SecretHash does not match for the client');
        });
    })

    it('should patch the plugin with valid client ID, and valid secret', async function () {
        const pluginPayload = {
            config: {
                client_id: [cognito.client_id],
                client_secret: [cognito.client_secret]
            }
        };
        const resp = await axios({ method: 'patch', url: `${url}/${pluginId}`, data: pluginPayload });
        logResponse(resp);
        expect(resp.status, `Status should be 200`).to.equal(200);
    })

    it('should return 302 when all configured credentials are valid', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInCognito}`,
                validateStatus: null,
                maxRedirects: 0 // To avoid redirecting
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 302').to.equal(302);
            expect(resp.headers.location, 'Headers.Location should be correct').to.include('https://us-east-23bjckdk6u.auth.us-east-2.amazoncognito.com/oauth2/authorize');
        });
    })

    it('should return 200 with valid Authorization header', async function () {
        // Fetch access token with valid credentials 
        await eventually(async () => {
            const secretHash = generateSecretHash(cognito.username, cognito.client_id, cognito.client_secret);
            const auth = {
                username: cognito.username,
                password: cognito.password,
                client_id: cognito.client_id,
                secret_hash: secretHash
            };
            const resp = await authenticateWithCognito(auth);
            logResponse(resp);
            expect(resp.status, 'Status should be 200').to.equal(200);
            expect(resp.data, 'Body should include AuthenticationResult').to.have.property('AuthenticationResult');
            expect(resp.data.AuthenticationResult, 'Body.AuthenticationResult should include AccessToken').to.have.property('AccessToken');
            accessToken = resp.data.AuthenticationResult.AccessToken;
        });
        
        // Use the fetched access token for the request
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInCognito}`,
                validateStatus: null,
                maxRedirects: 0,
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 200').to.equal(200);
            expect(resp.data.method, 'Body.method should be GET').to.equal('GET');
        });
    })

    it('should return 401 with invalid Authorization header', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInCognito}`,
                validateStatus: null,
                maxRedirects: 0,
                headers: {
                    Authorization: `Bearer ${accessToken}abcdefg12345678` // Invalid token
                }
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 401').to.equal(401);
            expect(resp.data.message, 'Body.message should be "Unauthorized"').to.equal('Unauthorized');
        });
    })

    it('should patch the plugin with an invalid issuer', async function () {
        const pluginPayload = {
            config: {
                issuer: 'https://cognito-idp.us-east-2.amazonaws.com'
            }
        };
        const resp = await axios({ method: 'patch', url: `${url}/${pluginId}`, data: pluginPayload });
        logResponse(resp);
        expect(resp.status, `Status should be 200`).to.equal(200);
    })

    it('should return 500 when configuring an invalid issuer', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInCognito}`,
                validateStatus: null,
            });
            logResponse(resp);
            const currentLogs = getGatewayContainerLogs(kongContainerName, 20);
            const isLogFound = findRegex(`authorization endpoint was not specified`, currentLogs);
            expect(
                isLogFound,
                'Should see logs for the test case'
            ).to.be.true;
            expect(resp.status, 'Status should be 500').to.equal(500);
            expect(resp.data.message, 'Body.message should be correct').to.equal('An unexpected error occurred');
        });
    })

    after(async function () {
        await deletePlugin(pluginId);
        await deleteGatewayRoute(routeId);
        await deleteGatewayService(serviceId);
    })
})


describe('Gateway Plugins: OIDC with Azure AD', function () {
    const url = `${getBasePath({ environment: isGateway() ? Environment.gateway.admin : undefined })}/plugins`;
    const proxyUrl = `${getBasePath({ app: 'gateway', environment: Environment.gateway.proxy })}`;
    const pathUsedInAzureAD = '/path1';
    const tenant_id = 'f177c1d6-50cf-49e0-818a-a0585cbafd8d';
    const app_oid = '8f9ecd54-3389-4e1d-af88-972b8abfa078'; // For testing purposes only
    const azureAD = {
        tenant_id,
        client_id: '936d49ba-bb4d-4407-91d8-c1be84f5c66a',
        client_secret: vars.azure_ad.AZURE_AD_CLIENT_SECRET,
        issuer: `https://login.microsoftonline.com/${tenant_id}/v2.0/.well-known/openid-configuration`
    };
    const consumer1Details: Consumer = {
        username: 'luka',
        custom_id: app_oid
    };
    let basePayload: object;
    let accessToken1: string;
    let accessToken2: string;
    let serviceId: string;
    let consumerId: string;
    let oidcPluginId: string;


    /**
     * Fetches an Azure AD access token using the provided credentials.
     * This function sends a request to Azure AD's OAuth2.0 token endpoint to retrieve the access token.
     *
     * @param tenant_id - The Azure AD tenant ID where the application is registered.
     * @param client_id - The client ID of the Azure AD application used for authentication.
     * @param client_secret - The client secret of the Azure AD application used to authenticate the request.
     * @returns The access token as a string.
    */
    const fetchAzureADAccessToken = async (tenant_id: string, client_id: string, client_secret: any) => {
        const data = querystring.stringify({
            client_id: client_id,
            client_secret: client_secret,
            grant_type: 'client_credentials',
            scope: `api://${client_id}/.default`,  
        });

        const resp = await axios({
            method: 'post',
            url: `https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data,
            validateStatus: null
        });
        logResponse(resp);
        if (resp.status !== 200) {
            console.dir(resp.data); // Log the response data to see its data
        }
        expect(resp.status, 'Status should be 200').to.equal(200);
        expect(resp.data, 'Body should have access_token').to.have.property('access_token');
        return resp.data.access_token;
    };

    /**
     * Tests rate limiting using the provided access token for pseudo-consumer testing.
     * Reusing the same Azure AD token triggers rate limiting, as each token maps to a unique consumer 
     * based on the 'credential_claim' in the OIDC configuration.
     *
     * @param url - The API endpoint URL to test rate limiting on.
     * @param accessToken - The OAuth2.0 access token (generated by Azure AD) used for authentication.
    */
    const testRateLimit = async (url: string, accessToken: string) => {
        const sendRequest = async (url: string, accessToken: string) => {
            const resp: any = await axios({
                method: 'get',
                url: url,
                validateStatus: null,
                maxRedirects: 0,
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });
            logResponse(resp);
            return resp;
        };

        for (let i = 0; i < 2; i++) {
            if (i === 0) {
                await eventually(async () => {
                    const resp = await sendRequest(url, accessToken);
                    expect(resp.status, 'Status should be 200').to.equal(200);
                    expect(resp.headers, 'Headers should have ratelimit-limit').to.have.property('ratelimit-limit');
                    expect(resp.data.method, 'Body.method should be GET').to.equal('GET');
                    expect(resp.data.headers, 'Body.headers should not have X-Consumer-Id').to.not.have.property('X-Consumer-Id');
                });
            } else {
                const resp = await sendRequest(url, accessToken);
                expect(resp.status, 'Status should be 429').to.equal(429);
                expect(resp.data.message, 'Body.message should be "API rate limit exceeded"').to.equal('API rate limit exceeded');
            }
        }
    };

    before(async function () {
        checkGwVars('azure_ad');
        const service = await createGatewayService(randomString());
        serviceId = service.id;
        await createRouteForService(serviceId, [pathUsedInAzureAD]);
        const consumer = await createConsumer(consumer1Details.username, consumer1Details);
        consumerId = consumer.id;
        basePayload = {
            name: "openid-connect",
            service: {
                id: serviceId
            },
            config: {
                issuer: azureAD.issuer,
                client_id: [azureAD.client_id],
                redirect_uri: [`${proxyUrl}${pathUsedInAzureAD}`],
                client_secret: [azureAD.client_secret],
                scopes: [
                    'openid',
                    'email',
                    'profile',
                    `${azureAD.client_id}/.default`
                ],
                verify_parameters: false,
                auth_methods: ["authorization_code", 'bearer'] // 'authorization_code' flow redirects user to login page; 'bearer' requires a valid access token
            }
        };
    })

    it('should create OIDC plugin', async function () {
        const resp = await createPlugin(basePayload);
        oidcPluginId = resp.id;
    })

    it('should return 302 for missing Authorization header', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInAzureAD}`,
                validateStatus: null,
                maxRedirects: 0 // To avoid redirecting
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 302').to.equal(302);
            expect(resp.headers.location, 'Headers.Location should be correct').to.include(`https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/authorize`);
        });
    })

    it('should return 200 with valid Authorization header', async function () {
        // Fetch access token once
        await eventually(async () => {
            accessToken1 = await fetchAzureADAccessToken(tenant_id, azureAD.client_id, azureAD.client_secret);
        }, 12000, 1000); // Retry for 2 mins, with 1 sec interval

        // Use the fetched access token for the request
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInAzureAD}`,
                validateStatus: null,
                maxRedirects: 0,
                headers: {
                    Authorization: `Bearer ${accessToken1}`
                }
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 200').to.equal(200);
            expect(resp.data.method, 'Body.method should be GET').to.equal('GET');
            expect(resp.headers, 'Body.headers should have X-Consumer-Id').to.not.have.property('X-Consumer-Id');
        });
    })

    it('should return 401 with invalid Authorization header', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInAzureAD}`,
                validateStatus: null,
                maxRedirects: 0,
                headers: {
                    Authorization: `Bearer ${accessToken1}abcdefghijklmnop` // Invalid token
                }
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 401').to.equal(401);
            expect(resp.data.message, 'Body.message should be "Unauthorized"').to.equal('Unauthorized');
        });
    })

    it('should patch OIDC plugin with consumer_by and consumer_claim', async function () {
        const pluginPayload = {
            config: {
                consumer_by: ['custom_id'],
                consumer_claim: ['oid']
            }
        };
        const resp = await axios({ method: 'patch', url: `${url}/${oidcPluginId}`, data: pluginPayload });
        logResponse(resp);
        expect(resp.status, `Status should be 200`).to.equal(200);
    })

    it('should return 200 with valid Authorization header, and consumer-mapping should work', async function () {
        // Use the fetched access token for the request, and verify and consumer-mapping should work
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInAzureAD}`,
                validateStatus: null,
                maxRedirects: 0,
                headers: {
                    Authorization: `Bearer ${accessToken1}`
                }
            });
            logResponse(resp);
            expect(resp.status, 'Status should be 200').to.equal(200);
            expect(resp.data.method, 'Body.method should be GET').to.equal('GET');
            expect(resp.data.headers, 'Body.haders should have X-Consumer-Id').to.have.property('X-Consumer-Id');
            expect(resp.data.headers['X-Consumer-Username'], `X-Consumer-Username in body.headers should be ${consumer1Details.username}`).to.equal(consumer1Details.username);
            expect(resp.data.headers['X-Consumer-Custom-Id'], `X-Consumer-Id in body.headers should be ${consumer1Details.custom_id}`).to.equal(consumer1Details.custom_id);
        });
    })

    it('should patch OIDC plugin with credential_claim - "uti"', async function () {
        const pluginPayload = {
            config: {
                consumer_claim: null,
                credential_claim: ['uti'] // Unique Token Identifier (UTI) used to uniquely identify the access token.
            }
        };
        const resp = await axios({ method: 'patch', url: `${url}/${oidcPluginId}`, data: pluginPayload });
        logResponse(resp);
        expect(resp.status, `Status should be 200`).to.equal(200);
    })

    it('should delete the mapped consumer and create a rate-limiting plugin for pseudo-consumer tests in OIDC plugin with Azure AD', async function () {
        //Delete the mapped consumer
        await deleteConsumer(consumerId);

        //Create a rate-limiting plugin
        const pluginPayload = {
            name: "rate-limiting",
            config: {
                hour: 1,
                policy: "local"
            }
        };
        const resp = await axios({ method: 'post', url, data: pluginPayload });
        logResponse(resp);
        expect(resp.status, `Status should be 201`).to.equal(201);
    })

    it('should rate limit on 2nd request for valid accessToken1 to ensure pseudo-consumer works', async function () {
        await testRateLimit(`${proxyUrl}${pathUsedInAzureAD}`, accessToken1);
    });

    it('should rate limit on 2nd request for valid accessToken2 to ensure pseudo-consumer works', async function () {
        await eventually(async () => {
            accessToken2 = await fetchAzureADAccessToken(tenant_id, azureAD.client_id, azureAD.client_secret);
        }, 12000, 1000); // Retry for 2 mins, with 1 sec interval

        await testRateLimit(`${proxyUrl}${pathUsedInAzureAD}`, accessToken2);
    });

    it('should return 401 with an invalid token when trying a pseudo-consumer and rate-limit is reached', async function () {
        // Function to make the request
        const makeRequest = async () => {
            return await axios({
                method: 'get',
                url: `${proxyUrl}${pathUsedInAzureAD}`,
                validateStatus: null,
                maxRedirects: 0,
                headers: {
                    Authorization: `Bearer ${accessToken1}abcdefghijklmnop` // Invalid token
                }
            });
        };
    
        // First request - expecting 401
        let resp = await makeRequest();
        logResponse(resp);
        expect(resp.status, 'Status should be 401').to.equal(401);
        expect(resp.data.message, 'Body.message should be "Unauthorized"').to.equal('Unauthorized');
    
        // Second request - expecting 401 again because rate-limit does not work on invalid token now
        resp = await makeRequest();
        logResponse(resp);
        expect(resp.status, 'Status should be 401').to.equal(401);
        expect(resp.data.message, 'Body.message should be "Unauthorized"').to.equal('Unauthorized');
    });

    after(async function () {
        await clearAllKongResources();
    })
})