// const Influx = require('influx');
import { InfluxDB } from 'influx';
import { Environment, getBasePath } from '../config/environment';

export let influx: any;

// for debugging you can enter the influxdb CLI via the below command from influx container
// influx -precision rfc3339

// for npm influx documentation
// https://node-influx.github.io/class/src/index.js~InfluxDB.html#instance-method-query

// Measurements in InfluxDB for Kong
const SERIES = {
  KONG_REQUEST: 'kong_request',
  KONG_DATASTORE_CACHE: 'kong_datastore_cache',
};

/**
 * Initialize new influxDB connection
 * @returns {object}
 */
export const createInfluxDBConnection = () => {
  const host = getBasePath({ environment: Environment.gateway.hostName });

  const influxDBUrl = `http://${host}:8086/kong`;

  influx = new InfluxDB(influxDBUrl);
  return influx;
};

/**
 * Retrieves all entries from the kong_request mesurement
 * @param {number} serviceId - filter by service id
 * @param {number} routeId - filter by route id
 * @returns {Array}
 */
export const getAllEntriesFromKongRequest = async (serviceId?: string, routeId?: string): Promise<object> => {
  const entries = await influx.query(`select * from ${SERIES.KONG_REQUEST}`);
  if (!routeId || !serviceId) {
    return entries;
  } else {
    return entries.filter((entry: any) => entry.route === routeId && entry.service === serviceId);
  }
};

/**
 * Retrieves all entries from the kong_request mesurement
 * @returns {Array}
 */
export const getAllEntriesFromKongDatastoreCache = async (): Promise<object> => {
  return await influx.query(`select * from ${SERIES.KONG_DATASTORE_CACHE}`);
};

/**
 * Get all existing data from a particular TAG or field
 * @param {number} indexOfEntry
 * @returns {object}
 */
export const getAllDataFromTargetTagOrField = async (
  indexOfEntry: number
): Promise<object> => {
  const entries = await influx.query(`select * from ${indexOfEntry}`);
  return entries;
};

/**
 * Execute custom query in influxDB
 * @param {string} customQuery
 * @returns {object}
 */
export const executeCustomQuery = async (
  customQuery: string
): Promise<object> => {
  const result = await influx.query(customQuery);
  return result;
};

/**
 * Delete all data from kong_request meaasurements
 */
export const deleteAllDataFromKongRequest = async () => {
  await influx.dropSeries({ measurement: SERIES.KONG_REQUEST });
  return;
};

/**
 * Delete all data from kong_datastore_cache meaasurements
 */
export const deleteAllDataFromKongDatastoreCache = async () => {
  await influx.dropSeries({ measurement: SERIES.KONG_DATASTORE_CACHE });
  return;
};
