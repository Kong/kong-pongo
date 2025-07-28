import {
  createGatewayService,
  createRouteForService,
  isCI,
  isKongOSS,
  Environment,
  expect,
  getBasePath,
  findRegex,
  isGateway,
  stopAndRemoveTargetContainer,
  updateDockerComposeFile,
  eventually,
  logResponse,
  getUnixTimestamp,
  runDockerContainerCommand,
  getNegative,
  runDockerComposeCommand,
  getGatewayContainerLogs,
  clearAllKongResources,
  getKongVersion,
  isGwHybrid,
  kubectlWaitPod,
  kubectlPortForward,
  executeTerraformCommand,
  checkPodsHealth,
  isGwNative,
  wait,
  stopAndRemoveMultipleContainers,
} from '@support';
import axios from 'axios';
import { Storage } from '@google-cloud/storage';
import { execSync } from 'child_process';
import {
    postGatewayEeLicense
} from '@shared/gateway_workflows';

/**
 * IMPORTANT NOTE
 * 1. This test only works in hybrid mode
 * 2. This test needs to be run with 4 kong dps running 
 *    so it will use yq command to attach additional dp configurations to the `docker-compose.yml` file
 * 3. This test covers the functionality of kong dp resilience in the event of kong control plan outage.
 *    [Learn more about this topic](https://docs.konghq.com/gateway/latest/kong-enterprise/cp-outage-handling/)
 *    With proper configurations, when a new kong dp was created in the event of kong control plan outage, it will pull the 
 *    latest kong gateway configurations from the GCP cloud storage and start proxying requests. We used 4 DPs to simulate how DP
 *    suppose to react in the event of control plan outage. 
 *    a. For kong-dp1, it will always be up and running from the begining when cp is up, this simulates normal cp dp setup
 *    b. For kong-dp2, it will have `KONG_CLUSTER_FALLBACK_CONFIG_IMPORT=on`, so when we bring `kong-dp2` after `kong-cp` is down, 
 *       it should pick up the configurations from GCP cloud storage folder and start proxying traffic 
 *    c. For kong-dp3, it will have `KONG_CLUSTER_FALLBACK_CONFIG_IMPORT=off`, so when we bring `kong-dp3` after `kong-cp` is down, 
 *       it should not pick up the configurations from GCP cloud storage and not traffic would be proxied 
 *    d. For kong-dp4, it will have `KONG_CLUSTER_FALLBACK_CONFIG_IMPORT=on` and also `KONG_CLUSTER_FALLBACK_CONFIG_EXPORT=on`, 
 *       so when we bring up `kong-dp4` after `kong-cp` is down, it should not only pick up configurations from GCP cloud storage 
 *       and start proxying traffic, it should also `register the node`(i.e create another file) in the election folder inside gcp cloud storage
 * 4. You need to have those extra environmental variables set in order to run this test properly
 *    GCP_SERVICE_ACCOUNT (also set this as part of the `CUSTOM_CONFIG_ALL` when generating `docker-compose.yml` with compose generator)
 *    KONG_VERSION,
 *    GW_MODE, 
 *    GW_IMAGE,
 *    GW_DP_IMAGE
 * 5. You also need to set those additional envrionment variables when run in the GKE mode 
 *    TF_VAR_kong_effective_semver
 *    TF_VAR_kong_version
 *    TF_VAR_kong_repository
 *    TF_VAR_unix_timestamp
 *    TF_VAR_aws_access_key_id
 *    TF_VAR_aws_secret_access_key
 *    TF_VAR_rla_redisu
 *    TF_VAR_rla_redisp
 * 6. Since this test requires interaction with `docker-compose.yml` file during test run, make sure you set
 *    `composeGeneratorFolderPath` properly in makefile when running locally
 */

const isHybrid = isGwHybrid();
const isPackageTest = isGwNative();

(isHybrid && !isPackageTest ? describe : describe.skip)('@smoke @gke: DP Resilience test for GCP', function () {
  this.timeout(700000)
  let serviceId: string
  let fileCount: number
  const bucketName = 'spdptest'
  const folder= 'test' + getUnixTimestamp() +'/'
  const subFolder = folder + getKongVersion() + '/'
  const configFilePath = subFolder + 'config.json'
  const serviceName = 'dpresilience-service'
  const routeName = 'dpresilience-route'
  const routePath = '/dpresilience'
  const cloudStoragePath = 'gcs://' + bucketName + '/' + folder.replace(/\/$/, "")
  const baseService = 'kong-dp1';
  const newServices = {
    'kong-dp2': ['8010:8000', '8453:8443', '8111:8101', '7011:7001', '9121:9111'],
    'kong-dp3': ['8020:8000', '8463:8443', '8121:8101', '7021:7001', '9131:9111'],
    'kong-dp4': ['8030:8000', '8473:8443', '8131:8101', '7031:7001', '9141:9111'],
  };
  
    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    })

    const dp1proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })

    const dp2proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy2 : undefined,
    })

    const dp3proxyUrl = getBasePath({   
        environment: isGateway() ? Environment.gateway.proxy3 : undefined,
    })

    const dp4proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy4 : undefined,
    })
 
    function skipIfIt(title, test) {
        const condition = process.env.GKE?.toLowerCase() == 'true';
        return condition ? it.skip(title, test): it(title, test);
    }
    const storage = new Storage();

    //function to delete the files in the GCS bucket folder and also delete the folder itself
    async function deleteCloudStorage() {
        try {
            console.log(`Deleting all files in GCS folder: ${folder}`);
            await storage.bucket(bucketName).deleteFiles({ prefix: folder });
            console.log(`Deleting GCS folder ${folder}`);
            await storage.bucket(bucketName).file(folder).delete();
        } catch (error) {
            if ((error as { code?: number }).code !== 404) {
                console.error('Error deleting GCS folder data:', error);
            }
        }
    }

  it('should reset kong containers', async function () {
    if (process.env.GKE!=='true') {
        // update the docker-compose yml file with yq command to update certain lines.
        // Purpose of this part is to keep docker-compose.yml in consistent state for test being rerunnable

        //append additional dps with configurations to the docker-compose.yml
        for (const [name, ports] of Object.entries(newServices)) {
            const portsList = ports.map(p => `"${p}"`).join(', ');
          
            const extraDPCommand = `
            .services."${name}" = (
            (.services."${baseService}" | explode(.) | to_yaml | from_yaml)
            | .container_name = "${name}"
            | .hostname = "${name}"
            | .ports = [${portsList}]
          )
          `.trim();

          updateDockerComposeFile(extraDPCommand)
        }

        //add the KONG_CLUSTER_FALLBACK_CONFIG_STORAGE configs to cp and dps
        const yq_commands = [
            `.services.kong-cp.environment.KONG_CLUSTER_FALLBACK_CONFIG_STORAGE = "${cloudStoragePath}"`,
            '.services.kong-cp.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "on"',
            `.services.kong-dp1.environment.KONG_CLUSTER_FALLBACK_CONFIG_STORAGE = "${cloudStoragePath}"`,
            '.services.kong-dp1.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "on"',
            '.services.kong-dp1.environment.KONG_CLUSTER_FALLBACK_CONFIG_IMPORT = "on"',
            '.services.kong-dp1.environment.KONG_DP_RESILIENCE_ELECTION_INTERVAL = 10',
            `.services.kong-dp2.environment.KONG_CLUSTER_FALLBACK_CONFIG_STORAGE = "${cloudStoragePath}"`,
            '.services.kong-dp2.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "on"',
            '.services.kong-dp2.environment.KONG_CLUSTER_FALLBACK_CONFIG_IMPORT = "on"',
            '.services.kong-dp2.environment.KONG_DP_RESILIENCE_ELECTION_INTERVAL = 30',
            `.services.kong-dp3.environment.KONG_CLUSTER_FALLBACK_CONFIG_STORAGE = "${cloudStoragePath}"`,
            '.services.kong-dp3.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "on"',
            '.services.kong-dp3.environment.KONG_DP_RESILIENCE_ELECTION_INTERVAL = 50',
            '.services.kong-dp3.environment.KONG_CLUSTER_FALLBACK_CONFIG_IMPORT = "on"',
            `.services.kong-dp4.environment.KONG_CLUSTER_FALLBACK_CONFIG_STORAGE = "${cloudStoragePath}"`,
            '.services.kong-dp4.environment.KONG_CLUSTER_FALLBACK_CONFIG_IMPORT = "on"',
            '.services.kong-dp4.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "on"',
            '.services.kong-dp4.environment.KONG_DP_RESILIENCE_ELECTION_INTERVAL = 70',
            ]
        for (const command of yq_commands) {
            updateDockerComposeFile(command)
        }
        
        // stop all the services on the docker-compose file
        try {
            execSync(`make stop_gw`, { stdio: 'inherit' });
        } catch (error) {
            console.error(`Something went wrong while stopping docker container`, error);
        }

        runDockerComposeCommand('up -d');
    } else {
        // set the environmental variable for kong-cp and recalibrate the kong pod when kong was setup with terraform
        process.env.TF_VAR_enable_extra_dp = 'false';
        process.env.TF_VAR_enable_kong_cp = 'true';
        process.env.TF_VAR_cp_cluster_fallback_config_export = 'on';
        process.env.TF_VAR_dp1_cluster_fallback_config_export= 'on';

        await eventually(async () => {
            let success = false;

            while (!success) {
                try {
                    const isPodHealthy = await checkPodsHealth('kong', ['kong-cp-kong', 'kong-dp1-kong']);
                    if(!isPodHealthy) {
                        await executeTerraformCommand('destroy -auto-approve');
                        await executeTerraformCommand('init -input=false');
                    }
                    await executeTerraformCommand('plan -out gwgkedeploy.plan -input=false');
                    await executeTerraformCommand('apply -auto-approve gwgkedeploy.plan');
                    await kubectlWaitPod('kong', 'kong-cp-kong');
                    await kubectlWaitPod('kong', 'kong-dp1-kong');
                    await kubectlPortForward('kong', 'kong-dp1-kong', '8000:8000 8443:8443');
                    // add additional wait time for kong-cp to be ready to avoid flakiness due to kubernetes API delay
                    await wait(5000); // eslint-disable-line no-restricted-syntax
                    await kubectlPortForward('kong', 'kong-cp-kong', '8001:8001 8002:8002');
                    success = true;
                } catch (error) {
                    console.log(`Something went wrong during executing the terraform command: ${error}`);
                    await executeTerraformCommand('destroy -auto-approve');
                    await executeTerraformCommand('init -input=false');
                }
            }
        }, 600000, 500, true);
    }

    await eventually(async () => {
        const resp = await axios({
          method: 'get',
          url: `${adminUrl}`,
          validateStatus: null,
        });
        expect(resp.status, 'Status should be 200').to.equal(200);
    });

    await eventually(async () => {
        const [files] = await storage.bucket(bucketName).getFiles({prefix: subFolder});
        files.forEach(file => {
        console.log(file.name);
        });
        fileCount = files.length;
        expect(fileCount, 'File count should be greater than 1').to.gte(1);
    }, 360000, 500, true);
  });

  skipIfIt('should temporarily stop extra kong containers', async function () {
    // stop kong-dp2 kong-dp3 kong-dp4
    const dp_containers = ['kong-dp2', 'kong-dp3', 'kong-dp4']
    for (const container of dp_containers) {
        stopAndRemoveTargetContainer(container)
    }
    
    // update the docker-compose yml file with yq command to remove depends_on 
    // for kong-dp2 kong-dp3 kong-dp4 so that we don't need to restart kong-cp
    const yq_commands = [
        'del(.services.kong-dp2.depends_on)',
        'del(.services.kong-dp3.depends_on)',
        'del(.services.kong-dp4.depends_on)',
        '.services.kong-dp2.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "off"',
        '.services.kong-dp3.environment.KONG_CLUSTER_FALLBACK_CONFIG_IMPORT = "off"'
        ]
    for (const command of yq_commands) {
        updateDockerComposeFile(command)
    }
  });

  it('should update the file content in GCP cloud storage', async function () {
    await eventually(async () => {
        const [files] = await storage.bucket(bucketName).getFiles({prefix: subFolder});
        files.forEach(file => {
        console.log(file.name);
        });
        fileCount = files.length;
        console.log(`File count: ${fileCount}`);
        expect(fileCount, 'File count should be greater than 1').to.gte(1);
    });

    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    await createRouteForService(serviceId, [routePath], { name: routeName});

    await eventually(async () => {
        const resp = await getNegative(`${dp1proxyUrl}${routePath}`);
        logResponse(resp);
        expect(resp.status, 'Status should be 200').to.equal(200);
    }); 

    //To temporarily unblock the testing due to https://konghq.atlassian.net/browse/KAG-6855, 
    //we temporarily upload the config.json to GCS, so that newly brought up kong dp could import
    //the config.json that actually has the service and route data, after the issue is fixed, we can remove this part
    await storage.bucket(bucketName).upload('./fixtures/dp_resilience_config.json', { destination: configFilePath });

    //Check whether the service and route info is actually updated in the config.json in gcs 
    await eventually(async () => {
        const [contents] = await storage.bucket(bucketName).file(configFilePath).download();
        const config = JSON.parse(contents.toString());
        expect(config.services, 'Service should be in config').to.exist;
        expect(config.routes, 'Route should be in config').to.exist;
        const service = config.services.find(
            (service) => service.name === `${serviceName}`
        );
        expect(service, 'serviceName should exist in config.services').to.exist;

        const route = config.routes.find(
            (route) => route.name === `${routeName}`
          );
        expect(route, 'routeName should exist in config.routes').to.exist;

    }, 600000, 5000, true);
  });

  it('should bring down kong cp with no issue', async function () {
    if (process.env.GKE!=='true') {
        await runDockerContainerCommand('kong-cp', 'stop');
    } else {
        // set the environmental variable for kong-cp
        process.env.TF_VAR_enable_extra_dp = 'true';
        process.env.TF_VAR_enable_kong_cp = 'false';
        // run the terraform command to bring down kong-cp and bring up kong-dp2 kong-dp3 kong-dp4
        try {
            await executeTerraformCommand('plan -out gwgkedeploy.plan -input=false');
            await executeTerraformCommand('apply -auto-approve gwgkedeploy.plan');
          } catch (error) {
            throw new Error(
              `Something went wrong during executing the terraform command: ${error}`
            );
        }
    }
    
    let isDown = false;
    await eventually(async () => {
        try {
            await axios.get(adminUrl, { timeout: 5000 });
            isDown = false;
        } catch (err: unknown) {
            const error = err as { code?: string };

            if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
                isDown = true;
            } else {
                isDown = true;
            }
        }
        expect(isDown, 'Admin API should be down').to.be.true;
    });
  });

  it('should bring up kong-dp2 with cluster import and proxy works', async function () {
    if (process.env.GKE!=='true') {
        await runDockerComposeCommand('up kong-dp2 -d');
    } else {
        // Execute the kubectl portforward command for kong-dp2
        try {
            await kubectlWaitPod('kong', 'kong-dp2-kong');
            await kubectlPortForward('kong', 'kong-dp2-kong', '8010:8010 8453:8453');
          } catch (error) {
            throw new Error(
              `Something went wrong during executing the kubectl portforward command: ${error}`
            );
        }
    }
    
    if(process.env.GKE!=='true') {
        await eventually(async () => {
            const currentLogs = getGatewayContainerLogs(
            'kong-dp2', 200
            );
            const isLogFound = findRegex('Fetching config from fallback storage', currentLogs);
            expect(
            isLogFound,
            'Should see config fallback storage log'
            ).to.be.true;
        }); 
    }

    await eventually(async () => {
        const resp = await axios({
            method: 'get',
            url: `${dp2proxyUrl}${routePath}`,
            validateStatus: null,
        });
        logResponse(resp);
        expect(resp.status, 'Status should be 200').to.equal(200);
    });
  });

  it('should bring up kong-dp3 with cluster export and proxy stops', async function () {
    if (process.env.GKE!=='true') {
        await runDockerComposeCommand('up kong-dp3 -d');
    } else {
        // Execute the kubectl portforward command for kong-dp3
        try {
            await kubectlWaitPod('kong', 'kong-dp3-kong');
            await kubectlPortForward('kong', 'kong-dp3-kong', '8020:8020 8463:8463');
          } catch (error) {
            throw new Error(
              `Something went wrong during executing the kubectl portforward command: ${error}`
            );
        }
    }

    await eventually(async () => {
        const resp = await getNegative(`${dp3proxyUrl}${routePath}`);
        logResponse(resp);
        expect(resp.status, 'Should have correct error code').to.equal(404);
    })
  });

  it('should bring up kong-dp4 with cluster export and proxy works', async function () {
    if (process.env.GKE!=='true') {
        await runDockerComposeCommand('up kong-dp4 -d');
    } else {
        // Execute the kubectl portforward command for kong-dp4
        try {
            await kubectlWaitPod('kong', 'kong-dp4-kong');
            await kubectlPortForward('kong', 'kong-dp4-kong', '8030:8030 8473:8473');
          } catch (error) {
            throw new Error(
              `Something went wrong during executing the kubectl portforward command: ${error}`
            );
        }
    }

    // Check the files count actually increased from begining
    await eventually(async () => {
        const [files] = await storage.bucket(bucketName).getFiles({prefix: subFolder});
        files.forEach(file => {
            console.log(file.name);
        });
        const newFileCount = files.length;
        console.log(`New file count: ${newFileCount}`);
        if (process.env.GKE!=='true'){
            expect(newFileCount, 'File count should be increased').to.above(fileCount);
        } else {
            //due to the issue logged at https://konghq.atlassian.net/browse/KAG-6855, the file inside election 
            //folder may not be created on time
            expect(newFileCount, 'File count should be increased').to.gte(fileCount);
        }
    }, 360000, 500, true);

    await eventually(async () => {
        const resp = await axios({
            method: 'get',
            url: `${dp4proxyUrl}${routePath}`,
            validateStatus: null,
        });
        logResponse(resp);
        expect(resp.status, 'Status should be 200').to.equal(200);
    });
  });

  it('should bring back kong cp and kong-dp ', async function () {
    if (process.env.GKE!=='true') {
        // update the docker-compose yml file with yq command to add cluster_fallback_config_import and export to
        // "off" for kong-dp2 kong-dp3 kong-dp4 and then bring up the kong again so that no new data is pushed to GCS bucket
        const servicesToDelete = Object.keys(newServices)
        await stopAndRemoveMultipleContainers(servicesToDelete)
        for (const svc of servicesToDelete) {
            const deleteCmd = `del(.services."${svc}")`;
            updateDockerComposeFile(deleteCmd)
        }
        const yq_commands = [
            '.services.kong-cp.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "off"',
            '.services.kong-dp1.environment.KONG_CLUSTER_FALLBACK_CONFIG_EXPORT = "off"',
            '.services.kong-dp1.environment.KONG_CLUSTER_FALLBACK_CONFIG_IMPORT = "off"',
            ]
        for (const command of yq_commands) {
            updateDockerComposeFile(command)
        }

        await runDockerComposeCommand('up -d');
    } else {
        // set the environmental variable for kong-cp
        process.env.TF_VAR_enable_extra_dp = 'false';
        process.env.TF_VAR_enable_kong_cp = 'true';
        process.env.TF_VAR_cp_cluster_fallback_config_export = 'off';
        process.env.TF_VAR_dp1_cluster_fallback_config_export= 'off';
        // run the terraform command to bring up kong-cp and bring down kong-dp2 kong-dp3 kong-dp4
        await eventually(async () => {
            let success = false;

            while (!success) {
                try {
                    await executeTerraformCommand('destroy -auto-approve');
                    await executeTerraformCommand('init -input=false');
                    await executeTerraformCommand('plan -out gwgkedeploy.plan -input=false');
                    await executeTerraformCommand('apply -auto-approve gwgkedeploy.plan');
                    await kubectlWaitPod('kong', 'kong-cp-kong');
                    await kubectlWaitPod('kong', 'kong-dp1-kong');
                    await kubectlWaitPod('kong', 'redis')
                    await kubectlPortForward('kong', 'kong-dp1-kong', '8000:8000 8443:8443');
                    // add additional wait time for kong-cp to be ready to avoid flakiness due to kubernetes API delay
                    await wait(5000); // eslint-disable-line no-restricted-syntax
                    await kubectlPortForward('kong', 'kong-cp-kong', '8001:8001 8002:8002');
                    await wait(5000); // eslint-disable-line no-restricted-syntax
                    await kubectlPortForward('kong', 'redis', '6379:6379');
                    success = true;
                } catch (error) {
                    console.log(`Something went wrong during executing the terraform command: ${error}`);
                }
            }
        }, 600000, 500, true);
    }
    
    // Check the kong cp is up
    await eventually(async () => {
        const resp = await axios({
          method: 'get',
          url: `${adminUrl}`,
          validateStatus: null,
        });
        expect(resp.status, 'Status should be 200').to.equal(200);
    });

    // Check the kong dp is up
    await eventually(async () => {
        const resp = await getNegative(`${dp1proxyUrl}`);
        logResponse(resp);
        expect(resp.status, 'Status should be 404').to.equal(404);
    });
    
    // Since we restarted the kong containers, we need to repost license again to avoid the afterAll hook failure
    if (isCI() && !isKongOSS()) {
        await postGatewayEeLicense();
    }
  });

  after(async function () {
    await clearAllKongResources();
    await deleteCloudStorage();
  });
});