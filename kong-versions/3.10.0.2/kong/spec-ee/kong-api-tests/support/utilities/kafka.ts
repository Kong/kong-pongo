import axios, { AxiosResponse } from 'axios';
import { expect } from '../assert/chai-expect';
import { Environment, getBasePath, isGateway } from '../config/environment';
import { eventually, vars, } from '@support';

export const kafkaConfig = {
    host: 'kafka',
    plainPort: 29092,
    saslPort: 9092,
    username: 'admin',
    password: 'admin-password',
}

export const confluentConfig = {
    host: 'pkc-921jm.us-east-2.aws.confluent.cloud',
    port: 9092,
    apiKey: vars.confluent.CLUSTER_API_KEY,
    apiSecret: vars.confluent.CLUSTER_API_SECRET,
    clusterName: 'lua-resty-kafka',
    topics: ['temp-test-1', 'temp-test-2'],
}

const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
})  
const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
})

/*
* Updates topic in a kafka plugin (kafka-log or kafka-consume)
* @param topicString - The topic to update to
* @param pluginId - The ID of the plugin to update
* @param path - The path to send the message to
* @param authMechanism - The authentication mechanism to use, if needed
* @returns {Promise<AxiosResponse>} - The response from the API
*/
const updateKafkaPluginTopic = async (topic: string, pluginId: string, pluginName: string, authMechanism?: string) => {
    const payload = {
        name: pluginName,
        config: {
            authentication: {
                user: kafkaConfig.username,
                password: kafkaConfig.password,
            },
            bootstrap_servers: [{
                host: kafkaConfig.host,
                port: kafkaConfig.plainPort,
            }],
        },
    }

    if (authMechanism) {
        payload.config.authentication['strategy'] = 'sasl'
        payload.config.authentication['mechanism'] = authMechanism
        payload.config.bootstrap_servers[0]['port'] = kafkaConfig.saslPort
    }

    if (pluginName === 'kafka-consume') {
        payload.config['topics'] = [{
            name: topic,
        }]
    } else {
        payload.config['topic'] = topic
    }

    const resp = await axios({
        method: 'patch',
        url: `${adminUrl}/plugins/${pluginId}`,
        data: payload,
        validateStatus: null,
    })

    expect(resp.status, 'Status should be 200').to.equal(200)
    if (pluginName === 'kafka-consume') expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': topic}])
    else expect(resp.data.config.topic, 'Should have correct topic').to.eql(topic)

    return resp
}


/* Updates the topic in Kafka-consume plugin
* @param topicString - The topic to update to
* @param pluginId - The ID of the plugin to update
* @param authMechanism - The authentication mechanism to use, if needed
* @returns {Promise<AxiosResponse>} - The response from the API 
*/
export const updateKafkaConsumeTopic = async (topic: string, pluginId: string, path: string, authMechanism?: string) => {
    let resp

    await updateKafkaPluginTopic(topic, pluginId, 'kafka-consume', authMechanism ? authMechanism : undefined)

    // ensure that topic has changed
    await eventually(async () => {
        resp = await axios.get(`${proxyUrl}${path}`)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data[topic].partitions["0"].records, 'should have new topic').to.eql({})
    }, 45000, 5000)

    return resp
}

/*
* Updates the kafka-log plugin to use a new topic
* @param topic - The topic to update to
* @param pluginId - The ID of the plugin to update
* @param authMechanism - The authentication mechanism to use, if needed
* @returns {Promise<AxiosResponse>} - The response from the API
*/
export const updateKafkaLogTopic = async (topic: string, pluginId: string, authMechanism?: string) => {
    const resp = await updateKafkaPluginTopic(topic, pluginId, 'kafka-log', authMechanism ? authMechanism : undefined)

    return resp
}

/* 
* Consumes a message from the kafka-consume plugin
* @param topicString - The topic to consume from
* @param path - The path to send the message to
* @param requestId - The request ID to check for
*/ 
export const consumeKafkaMessage = async (topic: string, path: string, requestId: string) => {
    let resp
    await eventually(async () => {
        // send message via kafka-consume plugin
        resp = await axios({
        method: 'get',
        url: `${proxyUrl}${path}`,
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should see record of request with correct topic').to.have.property(topic)
        expect(resp.data[topic].partitions["0"].records, 'Should see record of request with correct topic').to.not.eql({})
        expect(resp.data[topic].partitions["0"].records[0].value, 'Should have correct request ID').to.contain(requestId)
    }, 45000, 5000)

    return resp
}

/*
* Sends a message using log path for kafka-log 
* @param path - The path to send the message to
* @returns {Promise<string>} - The request ID of the message sent
*/
export const sendKafkaMessage = async(path: string) => {
    // send message via kafka-log plugin
    const resp = await axios.get(`${proxyUrl}${path}`)
    expect(resp.status, 'Status should be 200').to.equal(200)
    return resp
}


/* Extracts records from individual confluent cluster partitions and consolidates into one array
* @param resp - The response from the confluent-consume plugin
* @returns {Promise<any>} - The record from the response
*/
export const extractConfluentRecords = (resp: AxiosResponse, topic: string) =>  {
    const records: any[] = []
    for (const partition in resp.data[topic].partitions) {
        expect(resp.data[topic].partitions[partition].errcode, 'Should not have error code').to.equal(0)
        if (resp.data[topic].partitions[partition].records.length > 0) {
            for (const record of resp.data[topic].partitions[partition].records) {
                records.push(record)
            }
        }
    }
    return records
}

/* Runs a loop on the extracted Confluent records and compares the value of a property to an expected value
* @param records - The records to check
* @property - The property to check
* @expected_value - The expected value of the property
* @returns {Promise<any>} - The record from the response
* */
export const checkConfluentRecords = async (records: any[], property: string, expected_value: string) => {
    for (const record of records) {
        const parsedRecord = await JSON.parse(record.value)
        if (parsedRecord[property].match(expected_value)) {
            console.log('found record', record)
            expect(parsedRecord[property], `Should have record with property ${property} equal to ${expected_value}`).to.include(expected_value)
            break
        }
    }
}    

/*
* Updates the confluent plugin to use a new topic
* @param topic - The topic to update to
* @param pluginId - The ID of the plugin to update
* @returns {Promise<AxiosResponse>} - The response from the API
*/
export const updateConfluentTopic = async (topic: string, pluginId: string) => {
    // update confluent plugin to use new topic
    const resp = await axios({
        method: 'patch',
        url: `${adminUrl}/plugins/${pluginId}`,
        data: {
            config: {  
                topic: topic
            },
        },
    })
    expect(resp.status, 'Status should be 200').to.equal(200)
    expect(resp.data.config.topic, `Should have correct updated topic: ${topic}`).to.eql(topic)
    return resp
}

/*
* Updates the consume topic in the confluent plugin
* @param topic - The topic to update to
* @param pluginId - The ID of the plugin to update
* @returns {Promise<AxiosResponse>} - The response from the API
* */
export const updateConfluentConsumeTopic = async (topic: string, pluginId: string) => {
    // update consume plugin
    const resp = await axios({
        method: 'patch',
        url: `${adminUrl}/plugins/${pluginId}`,
        data: {
        config: {
                topics: [{"name": topic}],
            },
        },
    })

    expect(resp.status, 'Status should be 200').to.equal(200)
    expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': topic}])

    return resp
}

/* 
* Consumes a message from the confluent-consume plugin
* @param topicString - The topic to consume from
* @param path - The path to send the message to
* @param requestId - The request ID to check for
* @returns {Promise<any>} - The response from the API
*/ 
const consumeConfluentMessage = async (topic: string, path: string, timeout?: number) => {
    let resp
    await eventually(async () => {
        // send message via kafka-consume plugin
        resp = await axios({
            method: 'get',
            url: `${proxyUrl}${path}`,
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data[topic].partitions, `should see record of request with correct topic: ${topic}`).to.not.eql({})
    }, timeout ? timeout : 60000, 3000)

    return resp
}

/* Consumes and extracts a message from the confluent-consume plugin
* @param topicString - The topic to consume from
* @param path - The path to send the message to
* @returns {Promise<any>} - The record from the response
*/
export const consumeAndExtractConfluentMessage = async (topic: string, path: string, timeout?: number) => {
    const resp = await consumeConfluentMessage(topic, path, timeout)
    const records = extractConfluentRecords(resp, topic)
    expect(records, `Should have records for topic ${topic} in at least one partition`).to.have.lengthOf.at.least(1)
    
    return records
}

/*
* Sends a message using log path for confluent plugin
* @param path - The path to send the message to
* @returns {Promise<string>} - The request ID of the message sent
*/
export const sendConfluentMessage = async(path: string) => {
    const resp = await sendKafkaMessage(path)
    // confluent has extra path
    expect(resp.data, 'Should indicate that message sent successfully').to.have.property('message', 'message sent')
    return resp
}

