// this test can only be run in hybrid mode

import {
    isGwHybrid,
    getKongContainerName,
    updateEnvVariableInContainer,
    expect,
    eventually,
    getBasePath,
    isGateway,
    Environment,
    createGatewayService,
    createRouteForService,
    clearAllKongResources,
    getGatewayContainerLogs,
} from '@support';
import axios from 'axios';

const isHybrid = isGwHybrid()

const kongCpName = getKongContainerName()
const common_name = 'kong_clustering_dp';

const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}`
const proxyUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
})}`

/**
 * Check if the config setting is set to the expected value
 * @param setting - the config setting to check
 * @param value - the expected value
 */
const checkConfigSetting = async(setting: string, value: string) => {
    await axios.get(url).then((response) => {
        expect(response.status).to.equal(200);
    
        const config = response.data.configuration;

        expect(config).to.have.property(setting);
        expect(config[setting]).to.contain(value);
    })
}

/**
 * Check if the pki config is set to the expected value
 * @param mtls - the expected value for cluster_mtls
 * @param allowed_cns - the expected value for cluster_allowed_common_names
 */
const checkPkiConfigs = async (mtls: string, allowed_cns: string) => {
    await eventually(async () => {
        await checkConfigSetting('cluster_mtls', mtls)
        for (const cn of allowed_cns.split(',')) {
            await checkConfigSetting('cluster_allowed_common_names', cn)
        }
    })
}
/**
 * Set the PKI variables in the CP container
 * @param check_cn - boolean to check common name
 * @param allowed_cns - the allowed common names
 * @returns 
 */
const setPkiVars = (pki_setting: string, allowed_cns: string) => {
    const envVars = {
        KONG_CLUSTER_ALLOWED_COMMON_NAMES: allowed_cns,
        KONG_CLUSTER_MTLS: pki_setting
    }
    return updateEnvVariableInContainer(kongCpName, envVars)
}


(!isHybrid ? describe.skip : describe)('PKI tests in Hybrid mode', function() {
    it('should be able to validate common name when cluster_mtls is set to "pki_check_cn" and common name is listed in cluster_allowed_commmon_names', async function() {
        // set appropriate config: cluster_mtls = pki_check_cn and cluster_allowed_common_names = 'kong_clustering_dp'
        setPkiVars('pki_check_cn', common_name)
  
        await checkPkiConfigs('pki_check_cn', common_name)
    })

    it('should be able to proxy to the data plane when pki_check_cn mode is setup correctly', async function() {
        await createGatewayService('pki-test')
        await createRouteForService('pki-test', ['/pki_test'])

        // wait for the route to be available
        await eventually(async () => {
            const resp = await axios.get(`${proxyUrl}/pki_test`)
            expect(resp.status).to.equal(200)
        })
    })

    it('should be able to validate common name when it is in a list of allowed names', async function() {
        setPkiVars('pki_check_cn', 'kong_clustering_cp,kong_clustering_dp,another_allowed_name')

        await checkPkiConfigs('pki_check_cn', 'kong_clustering_cp,kong_clustering_dp,another_allowed_name')
    })

    it('should not validate dp when cluster_mtls is set to "pki_check_cn" and common name is not in the list', async function() {
        setPkiVars('pki_check_cn', 'different_common_name')

        await eventually(async() => {
            const logs = getGatewayContainerLogs(kongCpName)
            expect(logs).to.contain('data plane presented client certificate with incorrect CN during handshake')
        })

        await checkPkiConfigs('pki_check_cn', 'different_common_name')
    })

    it('should not start CP when cluster_allowed_common_names is not set', async function() {
        // set appropriate config: cluster_mtls = pki_check_cn and cluster_allowed_common_names = 'kong_clustering_dp'
        const envVars = {
            KONG_CLUSTER_MTLS: 'pki_check_cn',
            KONG_CLUSTER_ALLOWED_COMMON_NAMES: '',
        }
        const output = updateEnvVariableInContainer(kongCpName, envVars)
        // caught error output
        expect(output).to.contain(`this is insufficient to verify Data Plane identity when cluster_mtls = "pki_check_cn"`)
    })

    after(async () => {
        // clear all kong resources
        await clearAllKongResources()
        setPkiVars('pki', '')
    })
})
