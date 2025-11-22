// utils/gpioControl.js

// Detect platform - use mock on Windows, real GPIO on Linux
const isWindows = process.platform === 'win32';
let Gpio;

if (!isWindows) {
  try {
    // Only import onoff on Linux/Raspberry Pi
    const onoffModule = await import('onoff');
    Gpio = onoffModule.Gpio;
  } catch (err) {
    console.warn('⚠️ onoff package not available, using mock GPIO');
  }
}

// Mock Gpio class for development on Windows
class MockGpio {
  constructor(pin, direction) {
    this.pin = pin;
    this.direction = direction;
    this.value = 0;
  }

  writeSync(value) {
    this.value = value;
    console.log(`[MOCK GPIO] Pin ${this.pin} set to ${value}`);
  }

  readSync() {
    return this.value;
  }

  unexport() {
    console.log(`[MOCK GPIO] Pin ${this.pin} unexported`);
  }
}

// Use MockGpio if Gpio is not available
if (!Gpio) {
  Gpio = MockGpio;
  console.log('🔧 Using Mock GPIO for development (Windows detected)');
}

// Map socket numbers → GPIO pins (update with correct GPIO numbers!)
const lineMap = {
  1: 73,  // socket 0 → GPIO3
  2: 70,  // socket 1 → GPIO5
};

// Keep track of active GPIO instances
const gpioInstances = {};

// Turn ON the socket
export function turnOnSocket(socketNumber) {
  const gpioNumber = lineMap[socketNumber];
  if (gpioNumber === undefined) {
    throw new Error(`Invalid socket number: ${socketNumber}`);
  }

  try {
    // Reuse or create the GPIO instance
    if (!gpioInstances[socketNumber]) {
      gpioInstances[socketNumber] = new Gpio(gpioNumber, 'out');
    }

    const gpio = gpioInstances[socketNumber];
    gpio.writeSync(1);
    console.log(`✅ Socket ${socketNumber} activated (GPIO ${gpioNumber})`);
  } catch (err) {
    console.error(`GPIO activation error (socket ${socketNumber}):`, err);
  }
}

// Turn OFF the socket
export function turnOffSocket(socketNumber) {
  const gpioNumber = lineMap[socketNumber];
  if (gpioNumber === undefined) {
    throw new Error(`Invalid socket number: ${socketNumber}`);
  }

  try {
    const gpio = gpioInstances[socketNumber];
    if (!gpio) {
      // Create instance if not yet initialized
      gpioInstances[socketNumber] = new Gpio(gpioNumber, 'out');
    }

    gpioInstances[socketNumber].writeSync(0);
    console.log(`❌ Socket ${socketNumber} deactivated (GPIO ${gpioNumber})`);
  } catch (err) {
    console.error(`GPIO deactivation error (socket ${socketNumber}):`, err);
  }
}

// Optional: Clean up GPIOs on app exit
process.on('SIGINT', () => {
  Object.entries(gpioInstances).forEach(([socket, gpio]) => {
    gpio.writeSync(0);
    gpio.unexport();
    console.log(`🧹 Cleaned up socket ${socket}`);
  });
  process.exit();
});
