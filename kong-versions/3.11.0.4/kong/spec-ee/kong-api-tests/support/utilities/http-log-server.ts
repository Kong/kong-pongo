import axios from 'axios';
import { expect } from '../assert/chai-expect';
import { logResponse } from './logging';
import * as querystring from 'querystring';

export const getHttpLogServerLogs = async () => {
  const resp = await axios('http://localhost:9300/logs');
  logResponse(resp);

  expect(resp.status, 'Status should be 200').equal(200);

  return resp.data;
};

export const deleteHttpLogServerLogs = async () => {
  const resp = await axios({
    method: 'delete',
    url: 'http://localhost:9300/logs'
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 204').equal(204);
};

export const splunkServerSearchRequests = async (searchOperation) => {
  const data = {
    search: searchOperation,
    exec_mode: 'oneshot',
    output_mode: 'json'
  };
  const encodedData = querystring.stringify(data);
  const resp = await axios({
    method: 'POST',
    url: 'https://localhost:8089/services/search/jobs',
    headers: {
      'Authorization': `Basic ${Buffer.from('admin:splunkTe8t').toString('base64')}`, // Basic Auth
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: encodedData
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 200').equal(200);
  return resp.data;
};

export const getSplunkServerHttpLogs = async () => {
  const searchString = 'search index=main';
  const respBody = await splunkServerSearchRequests(searchString);
  return respBody; 
}

export const deleteSplunkServerHttpLogs = async () => {
  const deleteString = 'search index=* | delete';
  const respBody = await splunkServerSearchRequests(deleteString);
  expect(respBody.messages[0].type, `The messages[0].type should equal 'INFO'`).equal('INFO');
  expect(respBody.messages[0].text, `The messages[0].text should include 'events successfully deleted'`).include('events successfully deleted');
}