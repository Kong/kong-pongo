/**
 * Description:
 * This test file validates route priority handling in Kong Gateway.
 * It creates multiple routes with different configurations and verifies that requests are routed to the correct services.
 * 
 * Test Flow:
 * 1. Prepare multiple services for all test cases.
 * 2. Update the router flavor and route matching calculation based on environment variables.
 * 3. Create several routes with different configurations for each test scenario.
 * 4. Send a request to the routes using paths and verify the correct routed service.
 * 5. Delete the correctly routed route after the route request.
 * 6. Repeat steps 4-5 for each test scenario until all routes in the test scenario are deleted.
 * 7. Repeat steps 3-6 for all test scenarios.
 * 8. Repeat steps 2-7 for all router flavors.
 * 9. Clean up: Clear all Kong resources and reset environment variables at the end of the tests.
 */
import axios, {AxiosError} from 'axios';
import https from 'https';
import {
    expect,
    logResponse,
    randomString,
    wait,
    getKongContainerName,
    eventually,
    createGatewayService,
    createRouteForService,
    deleteGatewayRoute,
    clearAllKongResources,
    clearKongResource,
    resetGatewayContainerEnvVariable,
    createWorkspace,
    deleteWorkspace,
    createExpressionRouteForService,
    isGwHybrid,
    checkForArm64,
    getRouterFlavor,
    getTargetFileContent,
    waitForConfigRebuild,
    getIncrementalSyncStatus
} from '@support';

const datafile = getTargetFileContent('support/data/routes-priority/routes-priority.json');
const serviceIds: any = {
    workspace_default: [],
    workspace2: []
};
let isIncSyncMode: boolean;

const routesFlavor = [
    { flavor: "traditional_compatible", format: ['traditional'], route_match_calculation: 'original' },
    { flavor: "traditional_compatible", format: ['traditional'], route_match_calculation: 'strict' },
    { flavor: "expressions", format: ['traditional', 'expressions'], route_match_calculation: 'original' },
    { flavor: "expressions", format: ['traditional', 'expressions'], route_match_calculation: 'strict' }
];


//Creates services in the specified workspaces
const createServices = async function (servicesNumber: number, workspaceName?: string) {
    const urlPrefix = `http://httpbin/anything${workspaceName ? `/${workspaceName}` : ''}`;
    const serviceIds: string[] = [];

    for (let i = 0; i < servicesNumber; i++) {
        const name = `service${i}-${randomString()}`;
        const url = `${urlPrefix}/service${i}`;

        const service = await createGatewayService(name, { url }, workspaceName);
        serviceIds.push(service.id);

        await wait(10); // eslint-disable-line no-restricted-syntax
    }

    return serviceIds;
};

//Creates routes for the specified services
const createRoutes = async function (serviceIdsList: any, routesData: any) {
    const routeIds: string[] = [];

    const createRouteForServiceByFormat = async function (serviceId: string, routeInfo: any, workspace?: string) {
        if (routeInfo.expression) {
            return createExpressionRouteForService(serviceId, routeInfo.expression, routeInfo, workspace);
        }
        return createRouteForService(serviceId, routeInfo.paths, routeInfo, workspace);
    };

    for (let i = 0; i < routesData.length; i++) {
        const { paths = [], payload = {}, workspace } = routesData[i];
        payload.name = payload.name ? `${payload.name}-${randomString()}` : "route-test";
        payload.paths = paths;

        const serviceId = serviceIdsList[i];
        const route = await createRouteForServiceByFormat(serviceId, payload, workspace);

        routeIds.push(route.id);
        await wait(10); // eslint-disable-line no-restricted-syntax
    }

    return routeIds;
};

//Return expected services matchs based on route format and flavor
const getServicesMatchs = (routeFormat: any, routeFlavor: string, verify: any) => {
    const isSingleFormat = routeFormat.length === 1;

    if (!verify) return undefined;

    if (!isSingleFormat) {
        console.log(`Using hybrid format for route flavor: ${routeFlavor}`);
        if (checkForArm64() && verify.hybrid_arm64) {
            return verify.hybrid_arm64;
        }
        else {
            return verify.hybrid;
        }
    }

    if (routeFlavor === 'expressions') {
        return verify.expressions?.traditionalFormat;
    }

    return verify[routeFlavor];
};

//Verify routed service based on route request and expected service URL path and status codes
const verifyRoutedService = async function (routeRequest: any, expectedServiceUrlPath: string[], expectedStatusCodes: number[]) {
    await eventually(async () => {
        const isHttps = routeRequest.url.includes('https');

        const agent = isHttps
            ? new https.Agent({ rejectUnauthorized: false })
            : undefined;

        const resp = await axios({
            method: 'post',
            url: routeRequest.url,
            validateStatus: null,
            headers: routeRequest.headers,
            httpsAgent: agent
        });

        logResponse(resp);

        const expectedCodes = expectedStatusCodes ?? [200];
        expect(expectedCodes, `Actual status code ${resp.status} should be in: ${expectedCodes}`).to.include(resp.status);

        if (expectedServiceUrlPath) {
            const url = new URL(resp.data.url);
            const { hostname, pathname } = url;
            expect(resp.data.url, `URL should contain hostname: ${hostname}`).to.include(hostname);
            expect(expectedServiceUrlPath.toString(), `Expected path should include actual path: ${pathname}`).to.include(pathname);
        }
    })
}

//Create new workspace and delete old workspace if it exists
const safeCreateWorkspace = async function(name: string) {
    try {
        await createWorkspace(name);
    } catch (err) {
        const error = err as AxiosError;

        if (error.isAxiosError && error.response?.status === 409) {
            await deleteWorkspace(name);
            await createWorkspace(name);
        } else {
            throw err;
        }
    }
}

routesFlavor.forEach((route, index) => {
    const testData = JSON.parse(datafile || '{}');
    describe(`@smoke: Gateway Admin API: Routes priority - ${route.flavor} flavor, ${route.format.toString()} format (route_match_calculation: ${route.route_match_calculation})`, function () {
        const workspace2 = { name: 'workspace2' };
        const kongContainerName = getKongContainerName();

        before(async function () {
            await clearKongResource('routes');//Clear all data in case it is not removed beacuse process is killed
            isIncSyncMode = await getIncrementalSyncStatus();

            // Create 11 services in the default workspace and 2 services in workspace2
            if (index === 0) {
                await safeCreateWorkspace(workspace2.name);
                serviceIds.workspace2 = await createServices(2, workspace2.name);
                serviceIds.workspace_default = await createServices(11);
            }

            if (index !== 0) {
            // Set gateway environment variables
             await resetGatewayContainerEnvVariable(
                {
                    KONG_ROUTER_FLAVOR: route.flavor,
                    KONG_ROUTE_MATCH_CALCULATION: route.route_match_calculation,
                },
                kongContainerName
             );
             if (isGwHybrid()) {
                await resetGatewayContainerEnvVariable(
                    {
                        KONG_ROUTER_FLAVOR: route.flavor,
                        KONG_ROUTE_MATCH_CALCULATION: route.route_match_calculation,
                    },
                    'kong-dp1'
                );
             }

             await eventually(async () => {
                const actualFlavor = await getRouterFlavor();
                console.log(`Current router flavor: ${actualFlavor}`);
                expect(actualFlavor, `Expected router flavor to be: ${actualFlavor}`).to.equal(route.flavor);
             })
            }
        });

        testData.forEach((testCase: any) => {

            if( route.format.length <2 && testCase.format.length === 2 ) {
                console.log(`Skipping test case "${testCase.scenarioName}" for flavor "${route.flavor}" and format "${route.format.toString()}" as the test case requires hybrid format.`);
                return;
            }

            context(testCase.scenarioName, function () {
                const servicesExpected = getServicesMatchs(testCase.format, route.flavor, testCase.verify[route.route_match_calculation]);
                const routeIds: any = { workspace_default: [], workspace2: [] };
                let routeMatched: number[] = [];
                let workspaceMatched: string | undefined;

                before(async function () {
                    routeIds.workspace_default = await createRoutes(serviceIds.workspace_default, testCase.routeConfig);

                    if (testCase.routeConfig_workspace2) {
                        routeIds.workspace2 = await createRoutes(serviceIds.workspace2, testCase.routeConfig_workspace2);
                    }
                });


                after(async function () {
                    // Clear routes if not deleted successfully
                    await clearKongResource('routes');
                    // Remove test data in this case to avoid memory issue
                    testCase = null;
                });


                for (const match of servicesExpected) {
                    // Send request to the route and verify the routed service
                    it(`should ${match.testName}`, async function () {
                        await verifyRoutedService(testCase.request, match.services, match.status);
                        routeMatched = match.routes;
                        workspaceMatched = match.workspace;
                    });
                }

                afterEach(async function () {
                    // Delete matched routes after each test
                    for (const index of routeMatched) {
                        await wait(10); // eslint-disable-line no-restricted-syntax
                        console.log(`Deleting matched routes: ${routeMatched.toString()}, index: ${index}`);
                        const routeId = (!workspaceMatched) ? routeIds.workspace_default[index] : routeIds.workspace2[index];
                        await deleteGatewayRoute(routeId, workspaceMatched);
                        
                        // Wait for incremental sync to complete if in hybrid mode，KAG-7117
                        if (isIncSyncMode && isGwHybrid()) {
                            await waitForConfigRebuild();
                        }                        
                    }
                });
            })

        })

        after(async function () {
            if (index === routesFlavor.length - 1) {
                //Reset environment variables at the end of all tests
                await resetGatewayContainerEnvVariable(
                    {
                        KONG_ROUTER_FLAVOR: 'traditional_compatible',
                        KONG_ROUTE_MATCH_CALCULATION: 'original'
                    },
                    kongContainerName
                );
                if (isGwHybrid()) {
                    await resetGatewayContainerEnvVariable(
                        {
                            KONG_ROUTER_FLAVOR: 'traditional_compatible',
                            KONG_ROUTE_MATCH_CALCULATION: 'original'
                        },
                        'kong-dp1'
                    );
                }

                //Clear data in workspace2 and default workspace 
                await clearAllKongResources(workspace2.name);
                await deleteWorkspace(workspace2.name);
                await clearAllKongResources();
            }
        });

    })
})



