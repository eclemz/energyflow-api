import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

function parseOrigins() {
  // WEB_ORIGINS can be:
  // "http://localhost:3000,https://energyflow-dashboard.vercel.app"
  const raw = process.env.WEB_ORIGINS ?? 'http://localhost:3000';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowList = parseOrigins();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  app.use(cookieParser());

  app.use(
    compression({
      filter: (req, res) => {
        const accept = req.headers.accept ?? '';
        if (
          typeof accept === 'string' &&
          accept.includes('text/event-stream')
        ) {
          return false; // don't compress SSE
        }
        return compression.filter(req, res);
      },
    }),
  );

  app.enableCors({
    credentials: true,
    origin: (origin, cb) => {
      // allow server-to-server / curl / render health checks (no Origin header)
      if (!origin) return cb(null, true);

      // exact allow-list
      if (allowList.includes(origin)) return cb(null, true);

      // allow Vercel preview + prod domains
      // e.g. https://energyflow-dashboard.vercel.app or https://something-xxx.vercel.app
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-device-serial',
      'x-device-key',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ensure prisma initialized (optional)
  app.get(PrismaService);

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
