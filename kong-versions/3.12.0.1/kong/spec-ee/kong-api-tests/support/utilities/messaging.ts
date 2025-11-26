import axios, { AxiosResponse } from 'axios';
import { expect } from '../assert/chai-expect';
import { Environment, getBasePath, isGateway } from '../config/environment';
import { eventually, logResponse, vars, execCustomCommand, randomString } from '@support';
import solace from 'solclientjs'


// ===============
// Kafka and Confluent Functions
// ===============

export const kafkaConfig = {
    host: 'kafka',
    plainPort: 29092,
    saslPort: 9092,
    username: 'admin',
    password: 'admin-password',
}


export const schemaRegistryConfig = {
    url: 'http://schema-registry:8081',
    username: 'admin',
    password: 'admin-password',
}

export const confluentConfig = {
    host: 'pkc-921jm.us-east-2.aws.confluent.cloud',
    port: 9092,
    apiKey: vars.confluent.CLUSTER_API_KEY,
    apiSecret: vars.confluent.CLUSTER_API_SECRET,
    clusterName: 'sdet-cluster',
    clusterId: 'lkc-0m8r52',
    schemaRegistry: {
        url: 'https://psrc-l7opw.europe-west3.gcp.confluent.cloud',
        username: 'FSXUPGC2YPAMPNXK',
        password: vars.confluent.CONFLUENT_CLOUD_SR_PASSWORD,
    }
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
    // expect property topic: topic
    if (pluginName === 'kafka-consume') expect(resp.data.config.topics[0], 'Should have correct topic').to.have.property('name', topic)
    else expect(resp.data.config.topic, 'Should have correct topic').to.contain(topic)

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
        validateStatus: null
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should see record of request with correct topic').to.have.property(topic)
        expect(resp.data[topic].partitions["0"].records, 'Should see record of request with correct topic').to.not.eql({})
        expect(resp.data[topic].partitions["0"].records[0].value, 'Should have correct request ID').to.contain(requestId)
    }, 45000, 6000)

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
    logResponse(resp)
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
    expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': topic})

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
    }, timeout ? timeout : 60000, 10000)

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
/* Creates a new topic in Confluent Cloud
* @param topics[] - The topic(s) to create
* @returns {Promise<AxiosResponse>}[] - The response from the API
*/
export const createConfluentTopics = async (topics: string[]) => {
    const resps: AxiosResponse[] = []
    for (const topic of topics) {
        const resp = await axios({
            method: 'post',
            url: `https://${confluentConfig.host}:443/kafka/v3/clusters/${confluentConfig.clusterId}/topics`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(`${confluentConfig.apiKey}:${confluentConfig.apiSecret}`).toString('base64')}`,
            },
            data: {
                topic_name: topic,
                // use only 1 partition, keep topic data for 4 minutes up to 1Mb, after that remove the data
                partitions_count: 1,
                configs: [
                  { "name": "retention.ms", "value": "240000" },
                  { "name": "retention.bytes", "value": "1048576" }
                ]
            },
            validateStatus: null,
        })
        logResponse(resp)
        console.log('Created topic', topic, 'in Confluent Cloud')
        expect(resp.status, 'Status should be 201').to.equal(201)
        expect(resp.data.topic_name, 'Should have correct topic name').to.equal(topic)
        resps.push(resp)
    }
    return resps
}

/* Deletes a topic in Confluent Cloud
* @param topics[] - The topic(s) to delete
* @returns {Promise<AxiosResponse>}[] - The responses from the API
*/
export const deleteConfluentTopics = async (topics: string[]) => {
    const resps: AxiosResponse[] = []    
    for (const topic of topics) {
        const resp = await axios({
            method: 'delete',
            url: `https://${confluentConfig.host}:443/kafka/v3/clusters/${confluentConfig.clusterId}/topics/${topic}`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(`${confluentConfig.apiKey}:${confluentConfig.apiSecret}`).toString('base64')}`,
            },
            validateStatus: null,
        })
        expect(resp.status, 'Status should be 204').to.equal(204)
        resps.push(resp)
    }
    return resps
}


// ===================
// Solace Functions
// ===================

/**
 * Checks if Solace is running locally by executing a command to list Docker containers
 * @returns {Promise<string>} - The result of the command execution
 */
export const isSolaceLocal = () => {
  // run docker ps | grep solace
  return execCustomCommand('docker ps').includes('solace');
};

/**
 * Gets the Solace configuration object based on whether Solace is running locally or not
 * @returns {Object} - The Solace configuration object
 */
export const getSolaceConfig = () => {
  return isSolaceLocal()
    ? {
        host: `tcp://host.docker.internal:55554`,
        vpnName: 'default',
        username: 'admin',
        password: 'admin',
        queueNames: [`kong-initial`, `kong-backup`],
        sempUrl: 'http://localhost:8091',
        sempUsername: 'admin',
        sempPassword: 'admin',
      }
    : {
        host: `tcp://mr-connection-r2jumi675jp.messaging.solace.cloud:55555`,
        vpnName: 'demo',
        username: 'solace-cloud-client',
        password: vars.solace.SOLACE_CLOUD_PASSWORD,
        queueNames: [`kong-${randomString()}-initial`, `kong-${randomString()}-backup`],
        sempUrl: 'https://mr-connection-r2jumi675jp.messaging.solace.cloud:943',
        sempUsername: 'mission-control-manager',
        sempPassword: vars.solace.SOLACE_CLOUD_SEMP_PASSWORD,
      };
};

/**
 * Initializes the Solace session.
 * @returns The initialized Solace session.
 */
// let solaceConfig: any;

/**
 * Initializes the Solace session.
 * @returns The initialized Solace session.
 */
export const initSolace = () => {
  const solaceConfig = getSolaceConfig();
  // Initialize Solace session
  const factoryProps = new solace.SolclientFactoryProperties();
  factoryProps.profile = solace.SolclientFactoryProfiles.version10;

  solace.SolclientFactory.init(factoryProps);

  const session = solace.SolclientFactory.createSession({
    url: isSolaceLocal() ? 'tcp://localhost:55554' : solaceConfig.host,
    vpnName: solaceConfig.vpnName,
    userName: solaceConfig.username,
    password: solaceConfig.password,
  });

  return { session, solaceConfig };
};

/**
 * Checks if Solace is ready by making a request to the Solace Web UI.
 */
export const isSolaceDockerReady = async () => {
  if(!isSolaceLocal()) {
    return;
  }
  await eventually(async () => {
    const resp = await fetch('http://localhost:8091', { method: 'GET' });
    console.log('Solace Web UI is ready:', resp.status === 200);
    expect(resp.status).to.equal(200);
  });
};

/**
 * Sets up a Solace message consumer for a specific queue.
 * @param session The Solace session to use.
 * @param queueName The name of the queue to consume messages from.
 * @returns The created message consumer.
 */
export const setUpSolaceConsumer = (session: solace.Session, queueName: string) => {
  // Create message consumer to connect during the test
  const queueDescriptor = new solace.QueueDescriptor({ name: queueName, type: solace.QueueType.QUEUE });
  const messageConsumer = session.createMessageConsumer({
    queueDescriptor,
    acknowledgeMode: solace.MessageConsumerAcknowledgeMode.AUTO,
  });

  return messageConsumer;
};

/**
 * Creates Solace queues.
 * @param queueNames The names of the queues to create.
 */
export const createSolaceQueues = async (queueNames: string[], solaceConfig: any) => {
  console.log('Creating Solace queues:', queueNames);
  for (const queueName of queueNames) {
    await eventually(async () => {
      const resp = await axios({
        method: 'post',
        url: `${solaceConfig.sempUrl}/SEMP/v2/config/msgVpns/${solaceConfig.vpnName}/queues`,
        auth: {
          username: solaceConfig.sempUsername,
          password: solaceConfig.sempPassword,
        },
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          queueName: queueName,
          accessType: 'exclusive',
          permission: 'consume',
          ingressEnabled: true,
          egressEnabled: true,
        },
        validateStatus: null,
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    });
  }
};

/**
 * Deletes Solace queues.
 * @param queueNames The names of the queues to delete.
 */
export const deleteSolaceQueues = async (queueNames: string[], solaceConfig: any) => {
  for (const queueName of queueNames) {
    const resp = await axios({
      method: 'delete',
      url: `${solaceConfig.sempUrl}/SEMP/v2/config/msgVpns/${solaceConfig.vpnName}/queues/${queueName}`,
      auth: {
        username: solaceConfig.sempUsername,
        password: solaceConfig.sempPassword,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(resp.status, 'Status should be 200').to.equal(200);
  }
};

/**
 * Checks the content and destination of a Solace message.
 * @param message The received message.
 * @param expectedContent The expected content of the message.
 * @param destination The destination of the message.
 * @param expectedDestination The expected destination.
 */
export const checkSolaceMessage = (
  message: string,
  expectedContent: string,
  destination: solace.Destination | null,
  expectedDestination: string,
) => {
  console.log(`Checking Solace message: ${message}`);
  console.log(`destination: ${destination?.toString()}`);
  expect(message, 'Received message should include expected content').to.include(expectedContent);
  expect(destination?.toString(), `Destination should contain ${expectedDestination}`).to.contain(expectedDestination);
};


/**
 * Waits for the Solace session to be up and running.
 * @param session The Solace session to wait for.
 * @returns A promise that resolves when the session is up.
 */
export function connectSession(session: solace.Session): Promise<void> {
  return new Promise((resolve, reject) => {
    session.on(solace.SessionEventCode.UP_NOTICE, resolve);
    session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, reject);
    session.connect();
  });
}


/**
 * Register a schema in Schema Registry using Axios
 * @param subject - The subject name under which the schema will be registered
 * @param schema - The schema object (Avro or JSON Schema)
 * @param registryUrl - Schema Registry URL, e.g., 'http://localhost:8081'
 * @param schemaType - 'AVRO' or 'JSON'
 */
export const createSchema = async (
  subject: string,
  schema: object,
  registryUrl: string,
  schemaType: 'AVRO' | 'JSON' = 'AVRO',
  auth?: { username: any; password: any }
) => {
  const url = `${registryUrl}/subjects/${subject}/versions`;

  const resp = await axios.post(
    url,
    {
      schema: JSON.stringify(schema),
      schemaType: schemaType
    },
    {
      headers: {
        'Content-Type': 'application/vnd.schemaregistry.v1+json',
      },
      validateStatus: null,
      ...(auth ? { auth } : {})
    }
  );

  logResponse(resp);
  expect(resp.status, 'Status should be 200').to.equal(200);
  console.log(`Schema registered successfully. ID: ${resp.data.id}, Type: ${schemaType}`);
  return resp.data.id;
};


/**
 * Delete multiple schema subjects from Schema Registry using Axios (soft delete first, then permanent)
 * @param subjects - Array of subject names to delete
 * @param registryUrl - Schema Registry URL, e.g., 'http://localhost:8081'
 * @param auth - Optional basic auth { username, password }
 */
export const deleteSchemas = async (
  subjects: string[],
  registryUrl: string,
  auth?: { username: any; password: any }
) => {
  const results: Record<string, any> = {};

  for (const subject of subjects) {
    const softDeleteUrl = `${registryUrl}/subjects/${subject}`;
    const permDeleteUrl = `${registryUrl}/subjects/${subject}?permanent=true`;

    // 1️⃣ Soft delete
    let resp = await axios.delete(softDeleteUrl, {
      headers: { "Content-Type": "application/vnd.schemaregistry.v1+json" },
      validateStatus: null,
      ...(auth ? { auth } : {}),
    });
    logResponse(resp);
    expect(resp.status, `Soft delete status for "${subject}" should be 200`).to.equal(200);
    console.log(`Schema subject "${subject}" soft-deleted successfully`);

    // 2️⃣ Permanent delete
    resp = await axios.delete(permDeleteUrl, {
      headers: { "Content-Type": "application/vnd.schemaregistry.v1+json" },
      validateStatus: null,
      ...(auth ? { auth } : {}),
    });
    logResponse(resp);
    expect(resp.status, `Permanent delete status for "${subject}" should be 200`).to.equal(200);
    console.log(`Schema subject "${subject}" permanently deleted successfully`);

    results[subject] = resp.data;
  }

  return results;
};




/**
 * Creates a configuration object for Schema Registry in Kafka/Confluent plugins
 * 
 * @param {Object} params - Configuration parameters
 * @param {string} params.registry - Registry type identifier (e.g. 'confluent')
 * @param {Object} params.registryConfig - Registry-specific configuration
 * @param {string} [params.registryConfig.url] - Schema Registry URL
 * @param {Object} [params.registryConfig.authentication] - Authentication configuration
 * @param {Object} [params.registryConfig.value_schema] - Schema configuration for message values
 * @param {Array|Object} [params.topics] - Topics configuration for consumer plugins
 * @param {string} [params.mode] - Operating mode for the plugin
 * 
 * @returns {Object} Configuration object with schema_registry settings
 * 
 * @example
 * // Basic Confluent schema registry config
 * const config = makeSchemaRegistryConfig({
 *   registry: 'confluent',
 *   registryConfig: {
 *     url: 'http://schema-registry:8081',
 *     authentication: { mode: 'basic', basic: { username: 'admin', password: 'admin' } }
 *   }
 * });
 */
export const makeSchemaRegistryConfig = ({
    registry: registryName,
    registryConfig,
    topics,
    topic,
    mode,
}: {
    registry: string,
    registryConfig: {
        url?: string,
        authentication?: any,
        value_schema?: any,
    },
    topics?: any, // used for kafka-consume, confluence-consume
    topic?: any, // used for kafka-log, confluence
    mode?: string,
}) => {
    return {
        config: {
            schema_registry: {
                [registryName]: {
                    ...(registryConfig.url ? { url: registryConfig.url } : {}),
                    ...(registryConfig.authentication ? { authentication: registryConfig.authentication } : {}),
                    ...(registryConfig.value_schema ? { value_schema: registryConfig.value_schema } : {}),
                },
            },
            ...(topics ? { topics } : {}),
            ...(topic ? { topic } : {}),
            ...(mode ? { mode: mode } : {}),  
        },
    };
};