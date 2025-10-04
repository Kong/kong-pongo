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
