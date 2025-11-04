import { Gpio } from "onoff";

// Define the pins you wired the SSRs to
const sockets = {
  1: new Gpio(12, "out"),   // socket #1
  2: new Gpio(13, "out"),   // socket #2
};

// Initialize them to OFF (LOW)
Object.values(sockets).forEach(pin => pin.writeSync(0));

export const turnOnSocket = (socketNumber) => {
  const socket = sockets[socketNumber];
  if (!socket) throw new Error(`Invalid socket number: ${socketNumber}`);
  socket.writeSync(1); // HIGH = turn SSR ON
  console.log(`⚡ Socket ${socketNumber} turned ON`);
};

export const turnOffSocket = (socketNumber) => {
  const socket = sockets[socketNumber];
  if (!socket) throw new Error(`Invalid socket number: ${socketNumber}`);
  socket.writeSync(0); // LOW = turn SSR OFF
  console.log(`🛑 Socket ${socketNumber} turned OFF`);
};
