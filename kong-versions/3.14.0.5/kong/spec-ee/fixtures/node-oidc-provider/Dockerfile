FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install

COPY oidc_provider.js ./

EXPOSE 13000

CMD [ "node", "oidc_provider.js" ]
