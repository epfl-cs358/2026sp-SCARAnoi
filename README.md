<p align="center">
  <img src="docs/images/logo.svg" alt="SCARAnoi logo" width="400"/>
</p>

<p align="center">
  A SCARA robotic arm designed to solve the Tower of Hanoi using computer vision.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Robot-SCARA%20Arm-blue?style=for-the-badge" alt="SCARA Arm"/>
  <img src="https://img.shields.io/badge/Task-Tower%20of%20Hanoi-green?style=for-the-badge" alt="Tower of Hanoi"/>
  <img src="https://img.shields.io/badge/Vision-ESP32--CAM-orange?style=for-the-badge" alt="ESP32-CAM"/>
  <img src="https://img.shields.io/badge/Control-Arduino%20%2B%20RAMPS-red?style=for-the-badge" alt="Arduino and RAMPS"/>
</p>


# SCARA Arm - Solving Hanoi Tower

The SCARAnoi project aims to design and build a SCARA robot arm capable of solving the Tower of Hanoi problem using computer vision and autonomous manipulation.

The system combines a mechanically designed SCARA arm, a vertical motion axis, a parallel-jaw gripper, a Hanoi platform with three pegs and multiple disks, and a camera-based detection pipeline. The robot detects the position and size of the disks, determines the current configuration of the puzzle, computes the required sequence of moves, and executes the corresponding pick-and-place actions. It is designed to solve standard Tower of Hanoi configurations and to handle intermediate or non-standard configurations by recomputing the solution from the detected state.

Beyond the final demo, the project is meant to be reusable and extensible. The mechanical subsystems, perception pipeline, and motion control logic are separated as much as possible so that anyone can improve individual parts of the project without redesigning the entire system from scratch.

Enjoy building!


# Table of Contents

- [Autonomous Hanoi Solving](#autonomous-hanoi-solving)
- [How to Build](#how-to-build)
  - [Prerequisites](#prerequisites)
- [Hardware](#hardware)
  - [Base](#base)
  - [Arm](#arm)
  - [Gripper](#gripper)
  - [Hanoi Platform and Camera Support](#hanoi-platform-and-camera-support)
- [Electronics](#electronics)
- [Software](#software)
  - [Laptop or Server Software](#laptop-or-server-software)
  - [ESP32 Firmware](#esp32-firmware)
  - [Arduino Firmware](#arduino-firmware)
- [Motion](#motion)
  - [Shoulder and Elbow Motion](#shoulder-and-elbow-motion)
  - [Z-Axis Motion](#z-axis-motion)
  - [Gripper Motion](#gripper-motion)
  - [Homing and Limits](#homing-and-limits)
- [Computer Vision](#computer-vision)
- [Hanoi Algorithm](#hanoi-algorithm)
- [Autonomous Operation](#autonomous-operation)
- [Manual Control](#manual-control)
- [Bill of Materials](#bill-of-materials)
  - [Electrical Components](#electrical-components)
  - [Mechanical Components](#mechanical-components)
- [Possible Improvements](#possible-improvements)
- [Top contributors](#top-contributors)


# Autonomous Hanoi Solving

This video shows the SCARAnoi robot solving the Tower of Hanoi problem autonomously. The system detects the initial disk configuration, computes the sequence of moves, and commands the SCARA arm to pick and place the disks according to the rules of the puzzle.

[Insert demo video here.]


# How to Build

## Prerequisites

Before starting the build, make sure you have access to the fabrication tools needed for both the mechanical structure and the electronics. SCARAnoi is not only a 3D-printed robot: it also uses laser-cut MDF parts, rods, bearings, belts, motors, wiring, and embedded electronics. A small mechanical workshop setup is therefore very useful.

### 3D Printer

A 3D printer is needed for most of the custom mechanical parts of the robot. This includes parts of the SCARA arm, the gripper frame, the racks and pinion, the jaw holders, the jaws, the Hanoi disks, pulley adapters, spacers, and other small mechanical interfaces.

Most of the 3D-printed parts of SCARAnoi were made in PETG. TPU was used only for the side contact pieces of the gripper jaws. These softer pieces improve contact with the disks and help prevent slipping during pick-and-place movements.


### Laser Cutter

A laser cutter is required for the flat MDF structure of the robot. 

Make sure the MDF thickness matches the design files. If the material thickness is different, the slots may become too loose or too tight and the assembly may need to be adjusted.

### Soldering Equipment

Soldering equipment is needed for the electrical part of the robot. The system includes stepper motors, limit switches, an ESP32-CAM, a servo motor, buck converters, an Arduino Mega, and a RAMPS 1.4 board.

Heat-shrink tubing, connectors, and proper cable management are strongly recommended to avoid loose contacts, short circuits, or communication issues between the ESP32 and the Arduino.

### Mechanical Tools

Basic mechanical tools are required for assembling and adjusting the robot. 

Some parts may need small manual adjustments after fabrication. For example, rods may need to be cut to length, holes may need to be cleaned, and bearings or shafts may need to be fitted carefully.

Pay special attention to the moving assemblies. The Z-axis rods, lead screw, shoulder rotation, belts, pulleys, and gripper racks should move smoothly without excessive friction. Small alignment errors can create noise, wobbling, or missed steps during motion.

### Drill

A drill is useful for preparing or adjusting holes in MDF and 3D-printed parts. 

Be careful when drilling 3D-printed parts. If a hole becomes too large, the part may no longer hold screws, rods, or bearings firmly.

### Computer

A laptop or desktop computer is required to program and control the system. It is used to flash the Arduino firmware, program the ESP32-CAM, run the computer vision code, use the manual control interface, and test the autonomous Hanoi solver.


# Hardware

The hardware of the SCARAnoi project is composed of a SCARA robot arm designed to solve the Tower of Hanoi problem. The system consists of a base, a two-segment arm, a gripper, and a Hanoi platform with camera support.
The structure is divided into four main mechanical assemblies:

- Base
- Arm
- Gripper
- Hanoi Platform and Camera Support

The full mechanical assembly is available here: [Full SCARAnoi assembly design](path/to/the/full/assembly/file).


## Base

The base is the main structural support of SCARAnoi. It holds the vertical Z-axis mechanism, supports the rotating shoulder platform, and keeps the robot stable while the arm is moving.

The final version was redesigned as a laser-cut MDF structure with an attached electrical box. This box keeps the electronics accessible during debugging and integration, without needing to open the whole mechanical base every time.

The rotating shoulder platform is mounted on top of the moving Z-axis platform and forms the first rotational joint of the SCARA arm. It is driven by a GT2 belt transmission between a 20-tooth pulley and a 160-tooth pulley. This reduction increases the available torque at the shoulder, which is important because this joint carries the rest of the arm.

### Files to Laser Cut

- [Main base side plates](path/to/the/file)
- [Main base top and bottom plates](path/to/the/file)
- [electrical box side plates](path/to/the/file)
- [Electrical box cover](path/to/the/file)
- [Electrical box bottom plate](path/to/the/file)
- [Electrical box cover holders](path/to/the/file)
- [Upper lift mounting plate](path/to/the/file)

### Files to 3D Print

- [Shoulder platform](path/to/the/file)
- [Shoulder 160 teeths pulley](path/to/the/file)
- [Shoulder platform cover](path/to/the/file)
- [Rod clamp supports](path/to/the/file)
- [Limit switch holders](path/to/the/file)
- [Upper lift assembly side panel](path/to/the/file)
- [Upper lift assembly cover plate](path/to/the/file)
- [Mounting blocks](path/to/the/file)
- [Limit switch actuators](path/to/the/file)

### Bill of Materials

| Part | Quantity | Specification / Notes |
|---|---:|---|
| Smooth rods | 3 | 8 mm diameter, 420 mm length |
| T8 lead screw | 1 | 8 mm diameter, 400 mm length |
| Axial ball bearings | 2 | 50 mm inner diameter, 70 mm outer diameter, 14 mm width |
| Deep groove ball bearing | 1 | 10 mm inner diameter, 30 mm outer diameter, 9 mm width |
| Deep groove ball bearing | 1 | 8 mm inner diameter, 22 mm outer diameter, 7 mm width |
| GT2 belt | 1 | 6mm width, 400 mm length |
| GT2 pulley | 1 | 20-tooth motor pulley (or 16 to have a perfect 1:10 ratio) |
| Shaft coupler | 1 | 5 mm to 8 mm |
| Nema-17 Stepper motor | 2 | For the Z-axis vertical motion and the shoulder rotation|
| MDF sheet 10mm| 1 | For the box |
| MDF sheet 6mm| 1 | For the NEMA motor mounting plate |
| M2.5, M3 and M4 screws | As needed | For mechanical attachments |
| M2.5, M3 and M4S Heat inserts | As needed | For mechanical attachments |
| M10 Screw, Nut and washer | 1 | For fixing the shoulder to the base |
| Limit switches | 4 | For homing the shoulder and Z axis |

### Assembly Procedure

Laser cut the MDF parts for the main base and the attached electrical box. Start by assembling the main SCARA base with the finger joints. This base should not be permanently sealed, since some internal parts may still need to be accessed later, for example to tighten the shoulder screw or rearrange wires going through it. To make the side panels removable, we used small 3D-printed mounting blocks inside the base corners. Each block contains two M4S heat-set inserts, one for each adjacent side panel. The blocks are glued to the inner face of a horizontal panel, and the side panels are screwed into them using M4×12 screws. This keeps the base rigid while still allowing it to be opened if needed.

The electrical box is assembled separately. Its side and bottom panels can be glued normally, since it remains accessible from its own opening. Once assembled, attach it to the main base using M4 screws. 

Do not install the top face of the main SCARA base yet. Keeping the top open makes it easier to mount the Z-axis motor, the shoulder platform, the belt transmission, and the screw/nut assembly. If the top face is installed too early, it will probably need to be removed again.

Attach the shoulder platform to the 160-tooth pulley using four M2.5×12 screws. The two parts were printed separately to make iteration easier: if one part has a defect or needs a design change, only that part has to be reprinted. Insert four M2.5 heat-set inserts into the pulley, then screw the pulley to the shoulder platform.

Insert two M3 heat-set inserts for each rod clamp into the shoulder platform, for a total of six inserts. Place the three rod clamps and attach them using M3×12 screws.

The insert holes for the rod clamps pass through the shoulder platform. Flip the platform and reuse two accessible holes to mount the limit switch actuators. Avoid the clamp located on the belt side. Insert the heat-set inserts from the opposite side, then attach the two actuators using one M3×12 screw each.

Next, assemble the shoulder rotation stack on the top face of the main base. Place one axial ball bearing on the top face, centered around the 10 mm hole. Before placing the shoulder platform, put the belt around the 160-tooth pulley so it is already in position for the belt transmission. Seat it then on the first bearing, making sure the bearing fits correctly into the circular recess under the pulley at the bottom of it.

Place the second axial bearing in the circular recess on top of the shoulder platform, then add the shoulder platform cover. Align the 10 mm holes of the shoulder platform, pulley, bearings, and base top face. Insert the M10 screw from the top, through the full stack, until it comes out under the base top face. Add the washer and M10 nut from below, then tighten carefully. The stack should have no excessive play, but the shoulder must still rotate freely without too much friction.

Once the shoulder stack is assembled, adjust the belt transmission. Place the shoulder NEMA motor in the slots of the base top face and attach the 20-tooth pulley to the motor shaft. Pass the belt around both pulleys, then slide the motor in the slots to set the belt tension. The belt should be tight enough to avoid skipping, but not so tight that it makes rotation difficult. When the tension is correct, fix the motor using four M3×12 screws.

Before closing the main base, it is better to install and wire the three limit switches. This can still be done later, but the top face would need to be removed again. Two limit switches are mounted directly on the main base using M2 screws and nuts. If the screws are not long enough, drill the mounting holes slightly deeper.

The third limit switch is mounted on the shoulder platform. First screw it to its holder using two M2 screws, then attach the holder to the shoulder platform using two M2.5 screws. For this, insert two M2.5 heat-set inserts into the corresponding holes in the shoulder platform. Route the limit switch wires through the nearest hole in the main base, then pass them together with the motor wires through the opening between the main base and the electrical box.

After this, close the main SCARA base by installing the top face. Then install the three 8 mm smooth rods vertically. Insert each rod into its clamp support and tighten it using two M3 screws. These rods guide the moving shoulder platform during Z-axis motion and prevent it from tilting, so they should be as parallel as possible. If they are misaligned, the platform may create friction or get stuck.

Next, assemble the upper lift. Insert M3 heat-set inserts into the top and bottom screw holes of the upper lift side panel. Screw the side panel to the 6 mm MDF upper lift mounting plate. Place the Z-axis NEMA motor in the corresponding slot, screw it in place, and attach the shaft coupler to the motor shaft. Then screw the upper lift cover plate to the top of the side panel.

Connect the T8 lead screw to the other side of the shaft coupler, and insert the three 8 mm smooth rods into their corresponding holes in the upper lift cover plate.

At this point, the fixed structure of the robot is assembled: the main SCARA base, the electrical box, the shoulder platform, the smooth rods, and the upper lift assembly. The horizontal arm can be mounted later. During that step, the upper lift cover plate will need to be removed temporarily so the arm can be inserted onto the rods.

[Insert image of full base and electrical box assembly.]


## Arm

The arm is the main kinematic structure of the SCARA robot. It consists of two rigid segments connected by rotational joints.

Each joint is driven independently, giving the robot two degrees of freedom for horizontal motion. This allows the gripper to reach the different pegs of the Hanoi platform.

The arm uses a closed design with top covers to protect the internal components, such as belts, pulleys, shafts, and wiring.

### Files to Laser Cut

- [Top cover for the first arm segment](path/to/the/file)
- Top cover for the second arm segment
- Optional flat reinforcement plates

### Files to 3D Print

- [First arm segment body](path/to/the/file)
- Second arm segment body
- Pulley housings
- Bearing housings
- Spacer supports
- Motor attachment parts
- End-effector interface

### Other Parts

| Part | Quantity | Specification / Notes |
|---|---:|---|
| NEMA 17 stepper motors | 4 |  |
| Heat-set inserts | 2 |  |
| [Insert exact bearing references.] | 4 | 8 mm × 12 mm × 19 mm |

### Assembly Procedure

3D print the two arm bodies and laser cut the top covers. Before assembly, check that all holes for bearings, screws, shafts, and heat-set inserts are clean and correctly dimensioned.

Install the bearings into the rotational joint housings. The axial bearings support the vertical load transmitted through the arm and allow each segment to rotate smoothly.

Insert the spacer rods through the bearing assemblies and clamp them between the upper and lower plates. This keeps the joints rigid and aligned during motion.

Install the pulleys inside the arm segments. The elbow joint is driven through a GT2 belt transmission. In the project proposal, the elbow uses a 64-tooth driven pulley connected to a 16-tooth motor pulley, giving a 4:1 reduction ratio.

Install the gripper rotation transmission. The gripper rotation is transmitted through the elbow joint using a pulley system and an M5 screw used as a through-shaft. This allows the gripper to rotate independently without placing an additional motor at the end of the arm.

Mount the NEMA 17 motors close to the shoulder joint. Keeping the motors near the base reduces the moving mass and improves the dynamic behavior of the robot.

Adjust the belt tension by slightly shifting the motor position before tightening the screws. The belts should be tight enough to avoid slipping, but not so tight that they create excessive friction.

Close the arm segments with the laser-cut covers and verify that all internal components move freely.

[Insert image of full arm assembly.]


## Gripper

The gripper is the end-effector of the SCARA arm. It is designed to grasp, hold, transport, and release the Tower of Hanoi disks.

The selected system is a parallel-jaw gripper actuated by a rack-and-pinion mechanism. This design allows both jaws to move symmetrically, which helps keep the disks centered during grasping.

### Files to Laser Cut

No laser-cut parts are required for the gripper.

### Files to 3D Print

- [Gripper frame](path/to/the/file)
- 2 racks: [Rack A](path/to/the/file), [Rack B](path/to/the/file)
- [Pinion](path/to/the/file)
- 2 jaws: [Jaw A](path/to/the/file), [Jaw B](path/to/the/file)
- 2 TPU contact layers (contact layers with disks): [Layer 1](path/to/the/file), [Layer](path/to/the/file)

### Other Parts

| Part | Quantity | Specification / Notes |
|---|---:|---|
| DMS15 servo motor | 1 |  |
| Aluminium guide rods | 2 | 8 mm diameter |
| LM8UU linear bearings | As needed | 8 mm × 12 mm × 19 mm |
| M4 screws and inserts | 4 each | To attach jaws to racks |
| M3 screws and inserts | 4 each | To attach gripper frame to arm |

### Assembly Procedure

Begin by 3D printing the main frame, racks, pinion, and jaws. Check that the racks slide smoothly inside the main frame before installing the servo motor.

Insert the two 8 mm aluminium guide rods through the gripper frame. These rods guide the jaw holders and reduce lateral play.

Install the LM6UU linear bearings into the jaw holders. Each jaw holder should slide smoothly along the guide rods without excessive friction.

Attach each rack to its corresponding jaw holder using M3 screws. Make sure that both racks remain parallel and correctly aligned with the pinion.

Mount the DMS15 servo motor at the rear of the structure. Attach the metallic servo hub to the servo output shaft, then connect the pinion to the hub.

Position the pinion so that it meshes correctly with both racks. When the servo rotates, the two racks should move in opposite directions, producing symmetric opening and closing of the jaws.

Attach the two jaws to the racks. The inner surfaces of the jaws should remain parallel to ensure stable contact with the disks.

Test the gripper on all disk sizes before mounting it on the arm. Verify that the maximum jaw opening is sufficient for the largest disk and that the smallest disk can still be held reliably.

[Insert image of full gripper assembly.]


## Hanoi Platform and Camera Support

The Hanoi platform is the working environment of the robot. It holds the three pegs and the disks manipulated by the SCARA arm.

A camera support structure is integrated into the platform to provide a fixed overhead view of the puzzle. This fixed viewpoint helps the computer vision system detect the disk configuration more reliably.

### Files to Laser Cut

- [Main Hanoi platform](path/to/the/file)
- [Camera support box](path/to/the/file)
- 2 box connectors: [Connector Scara-Hanoi](path/to/the/file), [Connector Hanoi-Camera](path/to/the/file)

### Files to 3D Print

- 5 Hanoi disks: [Disk 1](path/to/the/file), [Disk 2](path/to/the/file), [Disk 3](path/to/the/file), [Disk 4](path/to/the/file), [Disk 5](path/to/the/file)
- [Camera case](path/to/the/file)
- [Peg head](path/to/the/file)

### Other Parts

| Part | Quantity | Specification / Notes |
|---|---:|---|
| Rods | 3 | 10 mm diameter, 8 mm inner diameter, used as pegs  |
| ESP32-CAM module | 1 |  |
| M3 Screws| As needed |  |
| MDF sheet| As needeed | We used 2, 10 mm for the hanoi box and connectors and 5mm for the camera box, but dimensions don't really matter|

### Disk Dimensions

The system uses 5 disks. Each disk has a height of 15 mm and a central hole of 14 mm diameter. The disk diameters range from 53 mm to 90 mm.

| Disk number | Diameter |
|---|---|
| 1, smallest | 53 mm |
| 2 | 60 mm |
| 3 | 70 mm |
| 4 | 80 mm |
| 5, largest | 90 mm |

### Assembly Procedure

Laser cut the main platform and the camera support structure from MDF. Assemble the platform using the joints.

Install the three pegs into the platform. The pegs should be spaced 90 mm apart from center to center. Make sure that they are vertical and firmly fixed.

3D print the 5 disks. Each disk should slide freely on the pegs without excessive friction. The 14 mm central hole provides clearance around the 10 mm pegs.

Mount the camera case to its support box, which is itself mounted at the end of the Hanoi-camera connector. This connector keeps the ESP32-CAM at a fixed position relative to the Hanoi pegs, which improves repeatability during computer vision detection.

There are no predefined screw holes in the camera support box so that the camera angle can be adjusted manually during assembly and once the desired angle is found, the screw holes can be drilled directly in the box. Verify that all three pegs and the full disk area are visible in the camera frame.

[Insert image of full Hanoi platform and camera support assembly.]


# Electronics

The electronics subsystem provides power, motion control, sensing, and communication for the SCARAnoi robot.

The system is centered around an Arduino Mega 2560 with a RAMPS 1.4 board. The RAMPS board distributes power and control signals to the motor drivers. A4988 drivers control the NEMA 17 stepper motors used for the SCARA arm motion.

An ESP32-CAM module is used for computer vision. It provides the camera feed used to detect the Hanoi disk configuration. Communication between the ESP32 and Arduino is handled through serial communication, with a logic-level converter used when necessary to protect the 3.3 V ESP32 pins from 5 V Arduino logic.

Power is supplied by a 12 V, 6 A DC power supply. Buck converters are used to provide regulated voltage levels for the servo motor and low-voltage electronics.

### Components

- Arduino Mega 2560
- RAMPS 1.4 board
- A4988 stepper drivers
- NEMA 17 stepper motors
- DMS15 servo motor
- ESP32-CAM
- FTDI USB-to-TTL adapter for programming the ESP32-CAM
- 8-channel logic-level converter
- Limit switches
- 12 V, 6 A DC power supply
- LM2596 buck converters
- Mini USB-B to USB-A cable
- Wires, connectors, heat-shrink tubing
- [Insert final wiring diagram.]
- [Insert final KiCad schematic.]

### Assembly Procedure

Mount the RAMPS 1.4 board onto the Arduino Mega 2560. Insert the A4988 drivers into the appropriate driver slots and verify their orientation before powering the board.

Connect the NEMA 17 motors to the RAMPS motor outputs. Check the coil wiring carefully to avoid incorrect motor behavior.

Connect the limit switches to the RAMPS inputs. These switches are used for homing and for preventing the arm from exceeding its mechanical range.

Connect the DMS15 servo motor to the dedicated power line from the 7 V buck converter. Do not power the servo directly from the Arduino 5 V rail.

Connect the ESP32-CAM to the system. Use the FTDI adapter for programming and use a logic-level converter for communication between the ESP32 and Arduino when required.

Before powering the full system, verify all voltage rails with a multimeter:
- 12 V main input
- 7 V servo supply
- 5 V low-voltage electronics supply
- 3.3 V ESP32 logic level

[Insert photo of final electronics box or wiring.]


# Software

The software stack is divided into three main layers:

1. High-level computer software running on a laptop or server
2. ESP32 firmware acting as communication hub and camera interface
3. Arduino Mega firmware handling low-level motion control

[Insert repository file tree.]


## Laptop or Server Software

The laptop or server handles computationally intensive tasks such as computer vision, disk detection, and Hanoi solving.

The planned software uses OpenCV and possibly object detection models to analyze the camera feed and determine the current state of the Tower of Hanoi puzzle. Once the disk configuration is detected, the software computes the sequence of moves required to solve the puzzle.

The output is then converted into movement commands for the robot.

### Main responsibilities

- Receive or fetch camera frames
- Detect disks and pegs
- Determine the current Hanoi configuration
- Sort disks by size
- Run the Tower of Hanoi solving algorithm
- Convert logical moves into robot movements
- Send commands to the ESP32 or Arduino

[Insert name of Python script.]

[Insert instructions to run the software.]


## ESP32 Firmware

The ESP32 acts as a communication bridge between the high-level software and the Arduino Mega.

In autonomous mode, it can receive generated commands from the laptop or server and forward them to the Arduino through serial communication. It can also support manual control by receiving user inputs and translating them into movement commands.

If the ESP32-CAM is used directly for vision, it also provides the camera stream used by the computer vision pipeline.

### Main responsibilities

- Provide camera stream
- Connect to Wi-Fi
- Receive commands from the laptop or server
- Forward commands to the Arduino Mega
- Optionally host a manual control interface
- Buffer commands to avoid communication stalls

[Insert ESP32 firmware filename.]

[Insert Wi-Fi setup instructions.]


## Arduino Firmware

The Arduino Mega is the low-level motion controller. It receives commands from the ESP32 and converts them into motor driver signals through the RAMPS 1.4 board.

The firmware controls the stepper motors, servo motor, homing routines, and safety limits.

The planned approach uses a customized version of MARLIN firmware configured for SCARA kinematics.

### Main responsibilities

- Receive commands through serial communication
- Execute SCARA motion
- Drive the stepper motors through RAMPS and A4988 drivers
- Control the gripper servo
- Read limit switches
- Execute homing routines
- Enforce motion limits

[Insert Arduino firmware filename.]

[Insert flashing instructions.]


# Motion

The motion subsystem controls the physical movement of the robot.

The SCARAnoi robot uses several degrees of freedom:

- Base or shoulder rotation
- Elbow rotation
- Z-axis vertical translation
- Gripper rotation
- Gripper opening and closing

## Shoulder and Elbow Motion

The two main arm joints control the horizontal position of the gripper above the Hanoi platform. These joints allow the robot to reach the three pegs and move disks between them.

The motors are placed close to the base when possible to reduce moving mass and inertia.

## Z-Axis Motion

The vertical axis allows the gripper to move up and down. This is used to approach the disk, grab it, lift it above the peg, move to another peg, and lower it into place.

The Z-axis is guided by four smooth rods and driven by a T8 lead screw.

## Gripper Motion

The gripper uses a servo-driven rack-and-pinion mechanism. When the pinion rotates, the two racks move in opposite directions, opening or closing the jaws symmetrically.

The gripper is designed to hold disks with diameters between 20 mm and 80 mm.

## Homing and Limits

Limit switches are used to define reference positions and prevent the robot from exceeding its mechanical range.

A homing routine should be executed at startup before autonomous motion.

[Insert homing procedure.]

[Insert axis limits.]


# Computer Vision

The computer vision subsystem detects the Tower of Hanoi configuration from camera images.

The ESP32-CAM is mounted above the Hanoi platform, giving a fixed overhead view of the disks and pegs. This fixed geometry helps make detection more repeatable.

The vision pipeline should identify the disks, estimate their sizes, determine which peg each disk is on, and reconstruct the full puzzle state.

### Planned detection steps

1. Capture image from the ESP32-CAM
2. Detect circular disk shapes
3. Estimate disk radii or diameters
4. Separate disks into stacks
5. Sort disks by size
6. Determine the current peg configuration
7. Send the configuration to the Hanoi solver

The vision system should first be tested independently from the robot motion. Once reliable, it can be integrated with the full autonomous workflow.

[Insert example camera image.]

[Insert detection output image.]

[Insert final computer vision script.]


# Hanoi Algorithm

The Hanoi solver computes the sequence of legal moves required to solve the puzzle.

For a classic Tower of Hanoi problem, the algorithm recursively moves smaller stacks between pegs while respecting the rule that a larger disk can never be placed on top of a smaller disk.

The solver receives the initial configuration, either manually entered by the user or detected by the camera, and computes the full list of moves required to reach the final configuration.

### Classic workflow

1. User starts the system
2. Camera detects the current disk configuration
3. Software reconstructs the Hanoi state
4. Solver computes the move sequence
5. Each logical move is converted into robot pick-and-place commands
6. The SCARA arm executes the full solution

[Insert solver filename.]

[Insert example input and output.]


# Autonomous Operation

The autonomous mode combines perception, planning, and physical execution.

The intended pipeline is:

1. Start the system
2. Home the robot
3. Capture the Hanoi platform image
4. Detect disk positions and sizes
5. Build the current puzzle state
6. Compute the Hanoi solution
7. Convert each move into robot coordinates
8. Execute pick-and-place operations
9. Verify or continue until solved

[Insert final command to run autonomous mode.]


# Manual Control

Manual control is useful for testing, calibration, and debugging.

The user should be able to move the arm manually through a software interface or command system.

### Manual actions

- Move shoulder joint
- Move elbow joint
- Move Z-axis up and down
- Rotate gripper
- Open and close gripper
- Run homing sequence
- Stop motion in case of problem

[Insert manual control interface.]

[Insert control commands.]


# Bill of Materials

The project uses both electrical and mechanical components.

## Electrical Components

[Insert final electrical BOM table.]

## Mechanical Components

[Insert final mechanical BOM table.]

# Possible Improvements

[ A list of possible improvements here ]

# Top contributors:

This project was made by:

- Rania Hida ([@Rania5724](https://github.com/Rania5724))
- Mehdi Belhaj ([@mehdi754-hub](https://github.com/mehdi754-hub))
- Youssef Benhayoun Sadafi ([@youssef-9511](https://github.com/youssef-9511))
- Ozan Esref Sahingöz ([@ozan-sz](https://github.com/ozan-sz))
- Jonathan Nilsson Pilemand ([@JonathanPilemand](https://github.com/JonathanPilemand))
- Maha El Qabli ([@melqabli](https://github.com/melqabli))
- Davood Hashimi ([@Davood-H](https://github.com/Davood-H))