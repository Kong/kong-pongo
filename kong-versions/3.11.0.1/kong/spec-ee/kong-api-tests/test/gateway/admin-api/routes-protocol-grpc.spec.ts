/*
  Covered scenarios:
  - gRPC unary / streaming call
  - gRPC and gRPCs route with headers
  - Error handling: NOT_FOUND, UNAVAILABLE, UNIMPLEMENTED
  - headers, and TLS override
  - Regex path routing
  Uncovered scenarios:
  - preserve_host (grpc-js does not support authority header)
*/
import {
  clearAllKongResources,
  createGatewayService,
  createRouteForService,
  expect,
  randomString,
  waitForConfigRebuild,
  getGatewayHost,
  getGatewayBasePath,
  createPlugin,
  eventually,
} from '@support';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const grpcGatewayBasePath = getGatewayBasePath('grpc');
const grpcGatewaySSLBasePath = getGatewayBasePath('grpcs');
// Define the gRPC and gRPCs addresses and protocols
const grpcAddress = 'grpcbin:9000';
const grpcProtocol = 'grpc';
const grpcsAddress = 'grpcbin:9001';
const grpcsProtocol = 'grpcs';
// Load the hello proto file
const helloPackageDef = protoLoader.loadSync('support/data/proto/hello.proto', {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
// Load the grpcbin proto file
const grpcbinPackageDef = protoLoader.loadSync('support/data/proto/grpcbin.proto', {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
// Load the hello proto definitions
const helloGrpcObject = grpc.loadPackageDefinition(helloPackageDef);
// Define the type for the hello proto
const helloProto = helloGrpcObject.hello as {
  HelloService: grpc.ServiceClientConstructor;
  HiService: grpc.ServiceClientConstructor; // Non-existing service for testing error handling
};
// using grpc to create clients
const helloClient = new helloProto.HelloService(grpcGatewayBasePath, grpc.credentials.createInsecure());
const sslCreds = grpc.credentials.createSsl(Buffer.alloc(0), null, null, {
  checkServerIdentity: () => undefined,
  rejectUnauthorized: false,
});
const helloClientWithSSL = new helloProto.HelloService(grpcGatewaySSLBasePath, sslCreds);
// using grpc to create clients with non-existing methods and ports on the server
const hiClientWithSSL = new helloProto.HiService(grpcGatewaySSLBasePath, sslCreds);
const clientWithWrongPort = new helloProto.HelloService(
  `grpc://${getGatewayHost()}:8100`,
  grpc.credentials.createInsecure(),
);
const client = new grpc.Client(grpcGatewayBasePath, grpc.credentials.createInsecure());
// metadata for gRPC requests
const metadata = new grpc.Metadata();
metadata.add('tag', 'test');
metadata.add('x-debug-host', 'konghq.com');
// Load the grpcbin proto definitions
const grpcbinGrpcObject = grpc.loadPackageDefinition(grpcbinPackageDef);
// Define the type for the grpcbin proto
const grpcbinProto = grpcbinGrpcObject.grpcbin as {
  GRPCBin: grpc.ServiceClientConstructor;
};
const grpcbinClient = new grpcbinProto.GRPCBin(grpcGatewayBasePath, grpc.credentials.createInsecure());
let patchRouteId: string;

describe('@smoke: Gateway Admin API: GRPC Route Tests', function () {
  context('gRPC Route with Existing and Non-existing Path', function () {
    before(async function () {
      const grpcServiceResponse = await createGatewayService(randomString(), {
        url: `${grpcProtocol}://${grpcAddress}`,
      });
      const grpcsServiceResponse = await createGatewayService(randomString(), {
        url: `${grpcsProtocol}://${grpcsAddress}`,
      });

      await createRouteForService(grpcServiceResponse.id, undefined, {
        name: randomString(),
        paths: [
          '/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo',
          '~/hello.HelloService/Say.*$',
          '/hello.HelloService/LotsOfReplies',
          '/hello.HelloService/LotsOfGreetings',
        ],
        protocols: ['grpc'],
        headers: { tag: ['test'] },
        preserve_host: true,
        regex_priority: 1,
      });

      await createRouteForService(grpcsServiceResponse.id, undefined, {
        name: randomString(),
        paths: [
          '/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo',
          '/hello.HelloService/BidiHello',
          '/hello.HiService/SayHi',
        ],
        protocols: ['grpcs'],
        headers: { tag: ['test'] },
        preserve_host: true,
        regex_priority: 1,
      });

      const route = await createRouteForService(grpcsServiceResponse.id, undefined, {
        name: randomString(),
        paths: ['/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo', '~/hello.HelloService/Say.*$'],
        protocols: ['grpc'],
        headers: { tag: ['test'] },
        preserve_host: true,
        regex_priority: 0,
      });

      patchRouteId = route.id;
      await createRouteForService(grpcServiceResponse.id, undefined, {
        name: randomString(),
        paths: ['~/grpcbin\\.GRPCBin/.*$', '~/grpcbin\\.GRPCBin/Specific.*$', '~/grpcbin\\.GRPCBin/SpecificError$'],
        protocols: ['grpc'],
        preserve_host: true,
        regex_priority: 1,
      });

      await waitForConfigRebuild();
    });

    it('should send gRPC request with unary mode', done => {
      helloClient.SayHello({ greeting: 'Kong' }, metadata, (err, res) => {
        if (err) {
          console.error(`Something went wrong sending gRPC request with unary mode:`, err);
          return done(err);
        }
        expect(res.reply).to.equal('hello Kong');
        done();
      });
    });

    it('should send gRPC request with server streaming', function (done) {
      const received: string[] = [];
      const stream = helloClient.LotsOfReplies({ greeting: 'Hi many times' }, metadata);

      stream.on('data', res => {
        received.push(res.reply);
      });

      stream.on('end', () => {
        expect(received.length).to.be.greaterThan(0);
        expect(received[0]).to.include('Hi many times');
        done();
      });

      stream.on('error', err => {
        console.error('Something went wrong when sending gRPC request with server streaming:', err);
        return done(err);
      });
    });

    it('should send gRPC request with client streaming', function (done) {
      const clientStream = helloClient.LotsOfGreetings(metadata, (err, res) => {
        if (err) {
          console.error('Something went wrong when sending gRPC request with client streaming:', err);
          return done(err);
        }
        try {
          expect(res.reply).to.include('Hi 1');
          expect(res.reply).to.include('Hi 2');
          done();
        } catch (err) {
          console.error('Something went wrong when sending gRPC request with client streaming:', err);
          return done(err);
        }
      });

      clientStream.write({ greeting: 'Hi 1' });
      clientStream.write({ greeting: 'Hi 2' });
      clientStream.end();
    });

    it('should send gRPCs request with bidirectional streaming', function (done) {
      const responses: string[] = [];
      const bidiStream = helloClientWithSSL.BidiHello(metadata);

      bidiStream.on('data', res => {
        responses.push(res.reply);
      });

      bidiStream.on('end', () => {
        expect(responses.toString()).to.include('Ping');
        expect(responses.toString()).to.include('Pong');
        done();
      });

      bidiStream.on('error', err => {
        console.error('Something went wrong when sending gRPC request with bidirectional streaming:', err);
        return done(err);
      });

      bidiStream.write({ greeting: 'Ping' });
      bidiStream.write({ greeting: 'Pong' });
      bidiStream.end();
    });

    it('should return 14 UNAVAILABLE when the port is incorrect', function (done) {
      clientWithWrongPort.SayHello({ greeting: 'Kong' }, metadata, err => {
        if (err) {
          expect(err.message).to.include('14 UNAVAILABLE');
          return done();
        }
        return done(new Error('Expected 14 UNAVAILABLE error, but got response'));
      });
    });

    it('should return 12 UNIMPLEMENTED when service NOT exists', function (done) {
      eventually(async () => {
        hiClientWithSSL.SayHi({ greeting: 'Kong' }, metadata, err => {
          if (err) {
            expect(err.message).to.include('12 UNIMPLEMENTED');
            return done();
          }
          return done(new Error('Expected 12 UNIMPLEMENTED error, but got response'));
        });
      });
    });

    it('should return 5 NOT_FOUND when route NOT match', function (done) {
      client.makeUnaryRequest(
        '/fake.Service/FakeMethod',
        arg => Buffer.from(JSON.stringify(arg)),
        buffer => JSON.parse(buffer.toString()),
        { greeting: 'Kong' },
        err => {
          if (err) {
            expect(err.code, 'Expected error code 5 (NOT_FOUND)').to.equal(5);
            expect(err.message, 'Expected error message 5 (NOT_FOUND)').to.include('NOT_FOUND');
            return done();
          }
          return done(new Error('Expected 5 NOT_FOUND error, but got response'));
        },
      );
    });

    it('should return 1 gRPC request matched gRPCs route', function (done) {
      const call = helloClient.BidiHello(metadata);

      call.on('error', err => {
        try {
          expect(err.message, 'Expected error message: 1 gRPC request matched gRPCs route').to.include(
            '1 CANCELLED: gRPC request matched gRPCs route',
          );
          done();
        } catch (assertionError) {
          done(assertionError);
        }
      });
    });

    it('should return 13 INTERNAL: grpc: error unmarshalling request', function (done) {
      client.makeUnaryRequest(
        '/hello.HelloService/SayHello',
        arg => Buffer.from(JSON.stringify(arg)),
        buffer => JSON.parse(buffer.toString()),
        { greeting: 'Kong' },
        metadata,
        err => {
          if (err) {
            expect(err.message, 'Expected error message: 13 INTERNAL: grpc: error unmarshalling request').to.include(
              '13 INTERNAL: grpc: error unmarshalling request',
            );
            return done();
          }
          return done(new Error('Expected 13 INTERNAL: grpc: error unmarshalling request, but got response'));
        },
      );
    });

    it('should send gRPC request with server streaming', function (done) {
      const received: string[] = [];
      const stream = helloClient.LotsOfReplies({ greeting: 'Hi many times' }, metadata);

      stream.on('data', res => {
        received.push(res.reply);
      });

      stream.on('end', () => {
        expect(received[0]).to.include('Hi many times');
        done();
      });

      stream.on('error', err => {
        console.error('Something went wrong when sending gRPC request with server streaming:', err);
        return done(err);
      });
    });

    it('should send DummyUnary request and get expected response', done => {
      const request = {
        f_sub: {
          f_string: 'hello',
        },
      };

      grpcbinClient.DummyUnary(request, (err, res) => {
        if (err) {
          console.error('gRPC call failed:', err);
          return done(err);
        }
        expect(res).to.have.nested.property('f_sub.f_string', 'hello');
        done();
      });
    });

    it('should receive CANCELLED error from SpecificError endpoint', done => {
      const request = { code: 1 };
      grpcbinClient.SpecificError(request, err => {
        expect(err.message).to.include('Canceled');
        done();
      });
    });

    //skipping this test as it is not applicable for gRPC (BUG: https://konghq.atlassian.net/browse/KAG-7278)
    it.skip('should return 14 unavailable if terminator enabled on the route with higher priority', function (done) {
      const payload = {
        name: 'request-termination',
        enabled: true,
        route: { id: patchRouteId },
        protocols: ['grpc', 'grpcs'],
        config: { echo: false, status_code: 503 },
      };

      helloClient.SayHello({ greeting: 'Kong' }, metadata, (err1, res1) => {
        if (err1) return done(err1);

        try {
          expect(res1.reply).to.include('Kong');
        } catch (assertErr) {
          return done(assertErr);
        }

        createPlugin(payload)
          .then(() => {
            helloClient.SayHello({ greeting: 'Kong' }, metadata, (err2, res2) => {
              if (err2) {
                try {
                  expect(err2.code).to.equal(5);
                  expect(err2.message).to.include('NotFound');
                  return done();
                } catch (assertErr) {
                  return done(assertErr);
                }
              } else {
                return done(new Error(`Expected error but got response: ${JSON.stringify(res2)}`));
              }
            });
          })
          .catch(err => done(err));
      });
    });

    after(async function () {
      await clearAllKongResources();
    });
  });
});
