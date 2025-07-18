import axios, { Method } from 'axios';
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Sends axios GET request which is expected to fail,
 * the request promise will always be reject so that test authors can perform checks on the failed response
 * @param {string} url - Axios request url
 * @param {object} headers - otpional request headers
 * @param {object|string} body - request body
 * @param {object} additionalOptions - { rejectUnauthorized: true } to ignore self-signed cert error
 * @returns {Object} - response property of the axios error response object
 */
export const getNegative = async (
  url: string,
  headers: object = {},
  body?: object | string,
  additionalOptions?: object | any
) : Promise<any> =>
    axios({
        url,
        headers,
        data: body,
        // Don't raise errors for any status code
        validateStatus: null,
        httpsAgent: additionalOptions?.rejectUnauthorized ? agent : null,
    });

/**
 * Sends post request which expected to fail,
 * the request promise will always be rejected so that test authors can perform checks on the failed response
 * @param {string} url - Axios request url
 * @param {object} data - Axios request data, defaults to empty object
 * @param {Method} method - Axios request method, defaults to post
 * @param {object} headers - Axios request headers, deafults to empty object
 * @param {object} additionalOptions - { rejectUnauthorized: true } to ignore self-signed cert error
 * @returns {Object} - response property of the axios error response object
 */
export const postNegative = async (
  url: string,
  data:string | object = {},
  method: Method = 'post',
  headers: object = {},
  additionalOptions?: object | any
) : Promise<any> =>
    axios({
        method,
        headers,
        url,
        data,
        // Don't raise errors for any status code
        validateStatus: null,
        httpsAgent: additionalOptions?.rejectUnauthorized ? agent : null,
    });

    /**
 * Sends patch request which expected to fail,
 * the request promise will always be rejected so that test authors can perform checks on the failed response
 * @param {string} url - Axios request url
 * @param {object} data - Axios request data, defaults to empty object
 * @param {Method} method - Axios request method, defaults to post
 * @param {object} headers - Axios request headers, deafults to empty object
 * @param {object} additionalOptions - { rejectUnauthorized: true } to ignore self-signed cert error
 * @returns {Object} - response property of the axios error response object
 */
export const patchNegative = async (
  url: string,
  data:string | object = {},
  method: Method = 'patch',
  headers: object = {},
  additionalOptions?: object | any
) : Promise<any> =>
    axios({
        method,
        headers,
        url,
        data,
        // Don't raise errors for any status code
        validateStatus: null,
        httpsAgent: additionalOptions?.rejectUnauthorized ? agent : null,
    });

   /**
 * Sends delete request which expected to fail,
 * the request promise will always be rejected so that test authors can perform checks on the failed response
 * @param {string} url - Axios request url
 * @param {object} data - Axios request data, defaults to empty object
 * @param {Method} method - Axios request method, defaults to post
 * @param {object} headers - Axios request headers, deafults to empty object
 * @param {object} additionalOptions - { rejectUnauthorized: true } to ignore self-signed cert error
 * @returns {Object} - response property of the axios error response object
 */
   export const deleteNegative = async (
    url: string,
    data:string | object = {},
    method: Method = 'delete',
    headers: object = {},
    additionalOptions?: object | any
  ) : Promise<any> =>
      axios({
          method,
          headers,
          url,
          data,
          // Don't raise errors for any status code
          validateStatus: null,
          httpsAgent: additionalOptions?.rejectUnauthorized ? agent : null,
      });    
