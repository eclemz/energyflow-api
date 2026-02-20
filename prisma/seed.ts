import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@energyflow.dev';
  const password = 'Admin123!';

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      fullName: 'EnergyFlow Admin',
      role: `ADMIN`,
    },
  });

  await prisma.device.upsert({
    where: { serial: 'INV-001' },
    update: {},
    create: {
      name: 'Inverter Unit 001',
      serial: 'INV-001',
      location: 'Demo Site',
      timezone: 'Africa/Lagos',
      readings: {
        create: [
          {
            ts: new Date(),
            solarW: 1200,
            loadW: 800,
            gridW: 0,
            inverterW: 800,
            batteryV: 51.2,
            batteryA: -12.5,
            soc: 68,
            tempC: 37.1,
            status: `OK`,
          },
        ],
      },
    },
  });

  await prisma.device.upsert({
    where: { serial: 'INV-002' },
    update: {},
    create: {
      name: 'Inverter Unit 002',
      serial: 'INV-002',
      location: 'Demo Site',
      timezone: 'Africa/Lagos',
    },
  });

  console.log('Seed complete ✅');
  console.log('Admin login:', adminEmail, password);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
