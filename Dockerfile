FROM ubuntu:16.04

RUN apt-get update

ENV NODE_VERSION 6.9.4
ADD https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.gz /node.tar.gz
RUN tar -xzf /node.tar.gz -C /usr/local --strip-components=1 && rm /node.tar.gz

RUN mkdir /memorybot
WORKDIR /memorybot

COPY package.json ./
RUN npm install

COPY lib/ ./lib/
COPY server.js  ./

ENV DATA_DIR /data
VOLUME /data

CMD ["npm", "run", "-s", "start"]
