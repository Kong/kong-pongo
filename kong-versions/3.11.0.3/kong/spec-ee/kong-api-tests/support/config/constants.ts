/**
 * Enum of available constants
 */
export const constants = Object.freeze({
  gateway: {
    ADMIN_AUTH_HEADER: 'Kong-Admin-Token',
    ADMIN_PASSWORD: 'handyshake',
  },
  kauth: {
    BASE_USER: {
      email: 'quality@konghq.com',
      fullName:
        'Quality Quality Quality Quality Quality Engineering Engineering Engineering Engineering',
      organization:
        'Kong Quality Engineering Kong Quality Engineering Kong Quality Engineering Kong Quality Engineering Kong Quality Engineering Kong Quality Engineering Kong Quality Engineering Kong Quality Engineering',
    },
    GATEWAY_USER: {
      email: 'quality+gatewaykonnect@konghq.com'
    }
  },
  datadog: {
    DATADOG_APPLICATION_KEY: '8c3e65176bc1c6ee662d72f74280bfc1b0e2d294'
  },
  conjur: {
    DOCKER_CONTAINER: 'conjur',
    CONJUR_ACCOUNT: 'myConjurAccount',
    CONJUR_URL: 'http://host.docker.internal:8083',
    CONJUR_APP: 'BotApp',
    CONJUR_LOGIN: 'User1@BotApp'
  }
});
