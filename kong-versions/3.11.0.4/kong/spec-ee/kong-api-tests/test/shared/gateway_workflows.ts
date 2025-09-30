import axios from 'axios';
import { getUrl, expect, logResponse, waitForConfigRebuild, getGatewayEELicense, eventually } from '@support';

const url = getUrl('licenses');

const validLicense = getGatewayEELicense();

export const postGatewayEeLicense = async () => {
  let resp: any = null;

  // wait until the server can post license
  await eventually(async () => {
   resp = await axios({
    method: 'post',
    url,
    data: {
      payload: validLicense,
    },
   });

  logResponse(resp);
  expect(resp.status, 'Status should be 201').to.equal(201);
  console.log('Gateway EE License was successfully posted');
  })

  // wait until the license is applied
  await eventually(async () => {
    await waitForConfigRebuild();
  });

  return resp.data;
};

export const deleteGatewayEeLicense = async () => {
  await eventually(async () => {
    const licenses = await axios(url);
    const licenseId = licenses.data.data[0]?.id;

    if (!licenseId) {
      console.log(`No Gateway EE License found to delete`);
      return;
    }
    
    const resp = await axios({
      method: 'delete',
      url: `${url}/${licenseId}`,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 204').to.equal(204);
  });
};



/**
 * Posts Gateway EE License if it doesn't already exist
 * @returns The license data, either existing or newly posted
 */
export const safePostGatewayEeLicense = async (): Promise<any> => {
  const check = await axios.get(url);
  
  // Check if license exists with proper data structure validation
  if (check.data?.data?.length > 0 && check.data.data[0]?.payload) {
    console.log('Gateway EE License already exists, skipping post');
    return check.data.data[0];
  }
  
  // No valid license found, proceed to post
  console.log('No valid Gateway EE License found, posting new license');
  
  let resp: any = null;
  
  // wait until the server can post license
  await eventually(async () => {
    resp = await axios({
      method: 'post',
      url,
      data: { payload: validLicense },
    });
    
    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    console.log('Gateway EE License was successfully posted');
  });
  
  // Wait until the configuration is fully applied
  await waitForConfigRebuild();
  
  return resp.data;
};