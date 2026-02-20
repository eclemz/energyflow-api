import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class IngestTelemetryDto {
  @IsOptional()
  @IsDateString()
  ts?: string;

  @IsOptional() @IsInt() solarW?: number;
  @IsOptional() @IsInt() loadW?: number;
  @IsOptional() @IsInt() gridW?: number;
  @IsOptional() @IsInt() inverterW?: number;

  @IsOptional() @IsNumber() batteryV?: number;
  @IsOptional() @IsNumber() batteryA?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  soc?: number;

  @IsOptional() @IsNumber() tempC?: number;

  @IsOptional()
  @IsString()
  status?: 'OK' | 'WARN' | 'FAULT' | 'OFFLINE';
}

// {
//   Device serial: INV-001
//   "deviceId": "cmlc5ozeh00013ziq5hinqe19",
//   "apiKey": "dev_07ba28dd46b33864efcf08a5f40a89189d72febd8e4e6935"
// }
