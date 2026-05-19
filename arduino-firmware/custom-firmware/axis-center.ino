void measureAxisCenter(char axisLetter, AxisPins &axis, bool (*minFunc)(), bool (*maxFunc)(), int minDir) {
  if (emergencyStopped) {
    printError(F("cannot measure while emergency stopped"));
    return;
  }
  
  enableMotors();
  // Safe, slow speed for measuring (1.5 milliseconds per step)
  unsigned long delayUs = 1500; 
  
  G_CODE_SERIAL.print(F("echo: Seeking MIN endstop for "));
  G_CODE_SERIAL.println(axisLetter);
  
  // 1. Move to MIN switch
  setDirection(axis, minDir);
  while (!minFunc()) {
    checkSerialEmergencyDuringMotion();
    if (emergencyStopped) return;
    stepAxis(axis);
    delayMicroseconds(delayUs);
  }
  
  // 2. Back off until MIN switch is open + a small margin of 100 steps
  setDirection(axis, -minDir);
  while (minFunc()) {
    stepAxis(axis);
    delayMicroseconds(delayUs);
  }
  for(int i=0; i<100; i++) { 
    stepAxis(axis); 
    delayMicroseconds(delayUs); 
  }
  
  // 3. Move to MAX switch and count steps
  G_CODE_SERIAL.println(F("echo: Seeking MAX endstop and counting steps..."));
  long totalSteps = 0;
  setDirection(axis, -minDir); // Move towards MAX
  
  while (!maxFunc()) {
    checkSerialEmergencyDuringMotion();
    if (emergencyStopped) return;
    stepAxis(axis);
    totalSteps++;
    delayMicroseconds(delayUs);
  }
  
  // 4. Calculate Center
  long centerSteps = totalSteps / 2;
  G_CODE_SERIAL.print(F("echo: ---> Total steps MIN to MAX: "));
  G_CODE_SERIAL.println(totalSteps);
  G_CODE_SERIAL.print(F("echo: ---> Steps to center: "));
  G_CODE_SERIAL.println(centerSteps);
  
  // 5. Back off MAX switch until open, then move to center
  G_CODE_SERIAL.println(F("echo: Moving to center point..."));
  setDirection(axis, minDir); // Move back towards MIN
  
  while (maxFunc()) {
    stepAxis(axis);
    centerSteps--; // Deduct the switch overlap from our journey so center is perfectly accurate
    delayMicroseconds(delayUs);
  }
  
  for (long i = 0; i < centerSteps; i++) {
    checkSerialEmergencyDuringMotion();
    if (emergencyStopped) return;
    stepAxis(axis);
    delayMicroseconds(delayUs);
  }
  
  G_CODE_SERIAL.println(F("echo: Reached center!"));
  G_CODE_SERIAL.println(F("echo: NOTE - Logical coordinates are now desynced. Send G28 to home or G92 to set position."));
}