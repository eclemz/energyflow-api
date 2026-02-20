import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      // allow browser to read API responses from another origin (localhost:3000)
      crossOriginResourcePolicy: { policy: 'cross-origin' },

      // optional: helps avoid some strict isolation issues in dev
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  app.use(cookieParser());
  app.use(
    compression({
      filter: (req, res) => {
        //  Do NOT compress SSE (EventSource)
        const accept = req.headers.accept ?? '';
        if (
          typeof accept === 'string' &&
          accept.includes('text/event-stream')
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  const origins = (process.env.WEB_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, cb) => {
      // allow server-to-server / curl / Postman (no Origin header)
      if (!origin) return cb(null, true);

      if (origins.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
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

  const prisma = app.get(PrismaService);

  await app.listen(process.env.PORT || 4000);
}
bootstrap();
