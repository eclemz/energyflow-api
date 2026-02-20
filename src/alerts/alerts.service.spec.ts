import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service';
import { beforeEach, describe, it } from 'node:test';

describe('AlertsService', () => {
  let service: AlertsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlertsService],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
function expect<T>(actual: T) {
  throw new Error('Function not implemented.');
}

