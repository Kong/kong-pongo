import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

import {
    Environment,
    expect,
    getBasePath,
    logResponse,
    isGateway,
    postNegative,
    wait,
    redisClient,
    resetRedisDB,
    waitForRedisDBSize,
    verifyRateLimitingEffect,
    isGwDbless,
} from '@support';

const adminUrl = `${getBasePath({ environment: isGateway() ? Environment.gateway.admin : undefined })}`;
const configDir = path.join(__dirname, '../../../support/data/dbless-config'); // Common directory path
const configFile = path.join(configDir, 'db-less-redis.yaml');
const configFileEmpty = path.join(configDir, 'db-less-empty.yaml');
const proxyUrl = `${getBasePath({ environment: isGateway() ? Environment.gateway.proxy : undefined })}/apitest`;
const isDbless = isGwDbless();

async function syncEmptyConfig(adminUrl: string) {
    const formEmpty = new FormData();
    formEmpty.append('config', fs.createReadStream(configFileEmpty));

    const resp = await axios({
        method: 'post',
        url: `${adminUrl}/config`,
        data: formEmpty,
    });

    expect(resp.status, 'Should sync config successfully').equal(201);
}

(isDbless ? describe : describe.skip)('@dbless: Gateway DB-Less mode Redis Partial Config Test', function () {
    
    before(async function () {
        //clean up the kong db-less gateway
        try {
            console.log('Uploading config to:', `${adminUrl}/config`);
            await syncEmptyConfig(adminUrl);
            console.log('Upload complete');
          } catch (err) {
            console.error('Upload failed:', err);
          }
        // connect to redis standalone client
        await redisClient.connect();
    });

    it('should not allow add service using admin api', async function () {
        const resp = await postNegative(
            `${adminUrl}/services`,
            {
                name: 'httpbin',
                url: 'http://httpbin',
            }
        );
        logResponse(resp);
        expect(resp.status, `Should not allow add service using admin api`).equal(405);
    });


    it('should sync config with linked redis partial and plugin', async function () {
        const form = new FormData();
        form.append('config', fs.createReadStream(configFile));
        const resp = await axios({
            method: 'post',
            url: `${adminUrl}/config`,
            data: form,
        });
        logResponse(resp);
        expect(resp.status, `Should sync config successfully`).equal(201);
    });


    it('should query all existing redis partials by partials endpoint', async function () {
        const resp = await axios({
            method: 'get',
            url: `${adminUrl}/partials`
        });
        logResponse(resp);
        expect(resp.status, 'Status should be 200').to.equal(200);
        const body = resp.data;

        expect(body).to.be.an('object');
        expect(body.data, 'data should be a non-empty array').to.be.an('array').that.is.not.empty;

        for (const partial of body.data) {
            expect(partial, 'Each item in data should be an object').to.be.an('object');
            expect(partial).to.have.property('name').that.is.a('string');
            expect(partial).to.have.property('type').that.is.a('string');
            expect(partial).to.have.property('config').that.is.an('object');
        }
    })

    it('should rate limit second proxy request according to RLA config linked to standalone redis partial', async function () {
        await resetRedisDB();
        await waitForRedisDBSize(0, 10000, 2000, true);
        await verifyRateLimitingEffect({ rateLimit: 1, url: proxyUrl });
    });

    it('should have counter sync to Redis standalone storage', async function () {
        //wait 2 seconds for counter sync
        await wait(2000);// eslint-disable-line no-restricted-syntax
        await waitForRedisDBSize(1, 3000, 1000, true);
    });

    after(async function () {
        // clean up the kong db-less gateway
        await syncEmptyConfig(adminUrl);
        await redisClient.quit();
    });
});
