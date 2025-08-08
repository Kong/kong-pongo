import axios from "axios";
import { runCommandInDockerContainer } from "support/exec/gateway-container";
import { logResponse } from "./logging";
import { expect } from '../assert/chai-expect';
import {constants} from '@support';

/**
 * This function creates a Conjur Account and returns the admin api token
 * @returns {string} - admin api token
 */
export const createConjurAccount = (): string => {
  const adminKey = runCommandInDockerContainer(constants.conjur.DOCKER_CONTAINER, `conjurctl account create ${constants.conjur.CONJUR_ACCOUNT} | grep 'API key' | awk '{print $NF}' | tr -d '\n'`);
  expect(adminKey, 'Should admin api token not be null').not.null
  expect(adminKey, 'Should admin api token not be empty').not.empty
  return adminKey;
}

/**
 * This function loads Conjur policy, creeates users and api tokens, set secrets and permissions
 * @returns {string} - returns user api token
 */
export const loadConjurPolicy = async (): Promise<string> => {
  const usrApiKey = runCommandInDockerContainer(constants.conjur.DOCKER_CONTAINER, `conjurctl policy load ${constants.conjur.CONJUR_ACCOUNT} /conjur/conjurPolicy.yml > my_app_data 2>&1 && cat my_app_data | awk '/"api_key":/{print $NF}' | tr -d '"' | sed -n 1p | tr -d '\n'`);
  expect(usrApiKey, 'Should user api token not be null').not.null
  expect(usrApiKey, 'Should user api token not be empty').not.empty
  return  usrApiKey;
}

/**
 * This function updates the Conjur policy, creeates a second secret variable
 */
export const updateConjurPolicy = async (): Promise<void> => {
  runCommandInDockerContainer(constants.conjur.DOCKER_CONTAINER, `conjurctl policy load ${constants.conjur.CONJUR_ACCOUNT} /conjur/addNewSecretPolicy.yml`);
}

/**
 * This function deletes the Conjur account to clean up the environment in order to retry
 * @returns {boolean} - returns delete success
 */
export const deleteConjurAccount = async (): Promise<boolean> => {
  const resp = runCommandInDockerContainer(constants.conjur.DOCKER_CONTAINER, `conjurctl account delete ${constants.conjur.CONJUR_ACCOUNT}`);
  return resp.includes("Deleted account 'myConjurAccount'");
}

/**
 * Request to authenticate with user API Key
 * @param {string} apiKey - conjur user api key
 * @returns {string} - access token
 */
const getConjurAccessToken = async (apiKey: string): Promise<any> => {
  // POST /{authenticator}/{account}/{login}/authenticate
  try {
    const resp = await axios({
      method: 'post',
      url: `http://localhost:8083/authn/${constants.conjur.CONJUR_ACCOUNT}/${constants.conjur.CONJUR_LOGIN}/authenticate`,
      data: apiKey,
      headers: {
        "Accept-Encoding": "base64"
      }
    });

    logResponse(resp);

    return resp.data;
  } catch (error) {
    console.log(error)
  }
}

/**
 * Request to set conjur secret value 
 * @param {string} apiKey - conjur user api key
 * @param {string} secretName - secret name
 * @param {string} secretValue - secret value
 * @returns {void}
 */
export const setConjurSecret = async (apiKey: string, secretName: string, secretValue: string): Promise<void> => {
  // POST /secrets/myConjurAccount/variable/BotApp%2FsecondVar
  try {
    const accessToken = await getConjurAccessToken(apiKey);
    const resp = await axios({
      method: 'post',
      url: `http://localhost:8083/secrets/${constants.conjur.CONJUR_ACCOUNT}/variable/${constants.conjur.CONJUR_APP}%2F${secretName}`,
      data: secretValue,
      headers: {
        "Content-Type": "text/plain",
        "Authorization": `Token token="${accessToken}"`
      }
    });

    logResponse(resp);

  } catch (error) {
    console.log(error);
  }
}
