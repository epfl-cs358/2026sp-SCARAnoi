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

---

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
- [Risk Assessment](#risk-assessment)
  - [Mechanical Risks](#mechanical-risks)
  - [Electrical Risks](#electrical-risks)
  - [Software Risks](#software-risks)
  - [Collision Risks](#collision-risks)
- [Possible Improvements](#possible-improvements)
- [Top contributors](#top-contributors)

---

# Autonomous Hanoi Solving

This video shows the SCARAnoi robot solving the Tower of Hanoi problem autonomously. The system detects the initial disk configuration, computes the sequence of moves, and commands the SCARA arm to pick and place the disks according to the rules of the puzzle.

[Insert demo video here.]

---

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

---


# Hardware

The hardware of the SCARAnoi project is composed of a SCARA robot arm designed to solve the Tower of Hanoi problem. The system consists of a base, a two-segment arm, a gripper, and a Hanoi platform with camera support.
The structure is divided into four main mechanical assemblies:

- Base
- Arm
- Gripper
- Hanoi Platform and Camera Support

---

## Base

The base is the main structural support of SCARAnoi. It carries the vertical Z-axis mechanism, supports the rotating shoulder platform, and keeps the robot stable while the arm is moving.

The final base was redesigned as a laser-cut MDF structure with an attached electrical box. The goal of this electrical box is to keep the electronics accessible during debugging and integration. In the earlier setup, accessing the electronics was inconvenient because the arm structure had to be lifted or moved. With the attached electrical compartment, the Arduino Mega, RAMPS board, buck converters, wiring, and power connections can be reached more easily without disassembling the robot. The base therefore has two main roles. The main structure supports the mechanical load of the arm, while the attached electrical box keeps the control electronics separated from the moving parts. Ventilation holes were also added to improve airflow around the electronics. 

On top of the moving Z-axis platform, the rotating shoulder platform provides the first rotational joint of the SCARA arm. This rotation is driven through a GT2 belt transmission using a 20-tooth pulley and a 160-tooth pulley. This increases the torque available at the shoulder, which is important because this joint supports the rest of the arm.

### Files to Laser Cut

[Insert base DXF files.]

- Main base side plates
- Main base top and bottom plates
- electrical box side plates
- Electrical box cover
- Electrical box bottom plate
- Electrical box cover holders
- Upper lift mounting plate

### Files to 3D Print

[Insert base STL files.]

- Shoulder platform
- Shoulder 160 teeths pulley
- Shoulder platform cover
- Rod clamp supports
- Limit switch holders
- Upper lift assembly side panel
- Upper lift assembly cover plate
- Mounting blocks
- Limit switch actuators

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

Laser cut the MDF parts for the main base and the attached electrical box. Start by assembling the main SCARA base with the finger joints and check that the structure is square and rigid. Unlike the electrical box, the main SCARA base should not be permanently sealed. Some parts inside the base may still need to be accessed later, for example to tighten the shoulder screw or to rearrange wires going through the base toward the Hanoi platform. To make this possible, we used small 3D-printed mounting blocks placed inside the base corners. Each block has two M4 heat-set inserts, one for each adjacent side panel. The block is glued to the inner face of a horizontal panel, and the side panels are then screwed into the inserts using M4x12 screws. This keeps the structure rigid during operation while still allowing the side panels to be removed when needed. The electrical box is assembled separately. Its side and bottom panels can be glued normally, since the box remains accessible from its own opening. Once assembled, the electrical box is attached to the main base using M4 screws (four M4x20 and two M4X30) . Keeping the main base and the electrical box detachable made the development process easier. The mechanical structure could be assembled and adjusted independently, while the electronics could be placed, wired, tested, or debugged without waiting for the full mechanical assembly to be finished.

To make the next assembly steps easier, do not install the top face of the main SCARA base yet. For now, only assemble the side panels and keep the top open. This gives easier access to the inside of the base when mounting the Z-axis NEMA motor, the shoulder platform, the belt transmission, and the screw/nut assembly. If the top face is installed too early, it will likely need to be removed again during the next steps.

Attach the shoulder platform to the 160-tooth pulley using four M2.5 × 12 mm screws. The shoulder platform and pulley were kept as separate printed parts to make iteration easier. During testing, if one section had a printing defect or needed a design change, we did not want to reprint the whole combined assembly. With this design, only the affected part has to be reprinted.To assemble them, insert four M2.5 heat-set inserts into the pulley, then screw the pulley to the shoulder platform.

Insert two M3 heat-set inserts for each rod clamp into the corresponding holes in the shoulder platform, for a total of 6 inserts. Then place the three rod clamps in position and attach them using M3×12 screws.

The heat-set insert holes for the rod clamps pass through the shoulder platform. Flip the platform and reuse two of these holes to mount the limit switch actuators. Since one clamp is located on the belt side, avoid using that position and choose two accessible holes instead. Insert the heat-set inserts from the opposite side, then attach the two limit switch actuators two M3x12 screws, one for each. 

Now assemble the whole shoulder rotation stack on top of the main SCARA base. Place one axial ball bearing on the top face of the base, centered around the 10 mm hole. Before continuing, place the belt around the 160-tooth pulley so it is already in position for the belt transmission later. The 160-tooth pulley has a tight-fit circular recess on its bottom side for the bearing. Place the pulley on top of the first axial bearing, making sure that the bearing is properly seated inside the hole. On the top side of the platform, there is a small circular recess matching the size of the second axial bearing. Place the second axial bearing inside it. Then place the shoulder platform cover on top of the second bearing. Align the 10 mm holes of the shoulder, the pulley, the bearings, and the top face of the base. Insert the M10 screw through these aligned holes, from the top of the shoulder platform down through the pulley and the base top face, until it comes out on the other side. Finally, add the washer and the M10 nut from the bottom side, then tighten them carefully. The assembly should be tight enough to remove play, but not so tight that the shoulder rotation becomes difficult or creates too much friction. 

With the shoulder rotation stack assembled, the belt transmission can now be adjusted. Place the NEMA motor for the shoulder rotation in the slots of the top face of the main SCARA base, then attach the 20-tooth pulley to the motor shaft. Pass the belt around the 20-tooth pulley and the shoulder 160-tooth pulley. Slide the motor inside the slots to adjust the belt tension. The belt should be tight enough to avoid skipping, but not so tight that it makes the shoulder rotation harder to move. When the belt tension is correct, fix the NEMA motor in place using four M3 × 12 mm screws. 

Before fully closing the main SCARA base by installing the top face, it is preferable to install and wire the three limit switches if possible (See the [Electronics](#electronics) section for the wiring details). This step can still be done later, but the top face of the box will have to be removed again. Since the box joints can be quite tight, removing it after assembly is a little tedious. It is easier to do this now, while the inside of the base is still accessible. Two of the limit switches are mounted directly on the main SCARA base. We used two M2×12 mm screws and nuts to fix them because it was the maximum length we could find for that screw size. Because the MDF is 10 mm thick and the limit switch is around 6 mm thick, the screws do not have much extra length. We therefore drilled the mounting holes in the MDF slightly deeper, just enough for the screws to go through the limit switch and still allow a nut to be placed on the other side. The third one is mounted on the shoulder platform. It is first screwed to a limit switch holder using two M2 screws. The limit switch holder is then screwed to the shoulder platform using two M2.5×8 screws. To do this, insert two M2.5 heat-set inserts into the corresponding holes in the shoulder platform. The limit switch wires can pass through the nearest hole in the main SCARA base. From there, route them and the motor wires through the opening between the main base and the electrical box so they can be connected to the electronics.

After this, the main SCARA base can be closed by placing the top face of the box. Once the top face is in place, install the three 8 mm smooth rods vertically. Insert each rod into its rod clamp support and tighten it using two M3 screws. These rods guide the moving shoulder platform during the Z-axis motion and prevent it from tilting. Try to keep the rods as parallel as possible. If they are not aligned correctly, the shoulder platform may create friction or get stuck during vertical movement.

Next, assemble the upper lift assembly. Take the upper lift assembly side panel and insert M3 heat-set inserts into the screw holes at the top and bottom. At the bottom, screw the side panel to the 6 mm MDF upper lift mounting plate. Place the Z-axis NEMA motor in the corresponding slot of the plate, then screw it in place. Attach the shaft coupler to the motor shaft. After this, screw the upper lift assembly cover plate to the top of the side panel. The T8 lead screw will then be connected to the other side of the shaft coupler, and the three 8 mm smooth rods should be inserted into their corresponding holes in the upper lift assembly cover plate.

At this point, the fixed structure of the robot is assembled: the main SCARA base, the shoulder platform, the smooth rods, and the upper lift assembly. The horizontal arm can be mounted later. When mounting the arm, the upper lift assembly cover plate may need to be removed temporarily so the arm can be inserted onto the rods correctly.

[Insert image of full base and electrical box assembly.]

---

## Arm

The arm is the main kinematic structure of the SCARA robot. It consists of two rigid segments connected by rotational joints.

Each joint is driven independently, giving the robot two degrees of freedom for horizontal motion. This allows the gripper to reach the different pegs of the Hanoi platform.

The arm uses a closed design with top covers to protect the internal components, such as belts, pulleys, shafts, and wiring.

### Files to Laser Cut

[Insert arm DXF files.]

- Top cover for the first arm segment
- Top cover for the second arm segment
- Optional flat reinforcement plates

### Files to 3D Print

[Insert arm STL files.]

- First arm segment body
- Second arm segment body
- Pulley housings
- Bearing housings
- Spacer supports
- Motor attachment parts
- End-effector interface

### Other Parts

- NEMA 17 stepper motors
- GT2 belts
- GT2 pulleys
- Axial bearings
- M5 × 80 mm screw used as through-shaft
- Vertical spacer rods
- Heat-set inserts
- M2.5, M3 and M4 screws
- [Insert exact belt lengths.]
- [Insert exact pulley tooth counts used in the final version.]
- [Insert exact bearing references.]

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

---

## Gripper

The gripper is the end-effector of the SCARA arm. It is designed to grasp, hold, transport, and release the Tower of Hanoi disks.

The selected system is a parallel-jaw gripper actuated by a rack-and-pinion mechanism. This design allows both jaws to move symmetrically, which helps keep the disks centered during grasping.

### Files to Laser Cut

No laser-cut parts are required for the gripper.

### Files to 3D Print

[Insert gripper STL files.]

- Gripper frame : 
- 2 racks : 
- Pinion : 
- 2 jaws : 
- 2 TPU layers (contact layers with disks) : 

### Other Parts

- 1 DMS15 servo motor
- 2 aluminium guide rods, 8 mm diameter
- LM8UU linear bearings, 8 mm × 12 mm × 19 mm
- 4 M4 screws + 4 M4 inserts (to attach jaws to racks)
- 4 M3 screws + 4 M3 inserts (to attach gripper frame to arm)

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

---

## Hanoi Platform and Camera Support

The Hanoi platform is the working environment of the robot. It holds the three pegs and the disks manipulated by the SCARA arm.

A camera support structure is integrated into the platform to provide a fixed overhead view of the puzzle. This fixed viewpoint helps the computer vision system detect the disk configuration more reliably.

### Files to Laser Cut

[Insert platform and camera support DXF files.]

- Main Hanoi platform
- Camera support beam
- Vertical camera mounting plate
- Base connection piece between the platform and robot base
- Tab-and-slot support parts

### Files to 3D Print

[Insert disk STL files.]

- 5 Hanoi disks
- Optional camera bracket
- Optional disk markers

### Other Parts

- 3 aluminium rods, 10 mm diameter, used as pegs
- ESP32-CAM module
- Screws or mounting hardware
- [Insert exact peg height.]
- [Insert exact camera mounting screws.]

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

Laser cut the main platform and the camera support structure from MDF. Assemble the platform using the tab-and-slot joints.

Install the three aluminium pegs into the platform. The pegs should be spaced 90 mm apart from center to center. Make sure that they are vertical and firmly fixed.

3D print the 5 disks. Each disk should slide freely on the pegs without excessive friction. The 14 mm central hole provides clearance around the 10 mm pegs.

Mount the camera support beam to the platform. This support keeps the ESP32-CAM at a fixed position relative to the Hanoi pegs, which improves repeatability during computer vision detection.

Mount the ESP32-CAM on the vertical plate and orient it downward toward the platform. Verify that all three pegs and the full disk area are visible in the camera frame.

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

---

# Software

The software stack is divided into three main layers:

1. High-level computer software running on a laptop or server
2. ESP32 firmware acting as communication hub and camera interface
3. Arduino Mega firmware handling low-level motion control

[Insert repository file tree.]

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

# Bill of Materials

The project uses both electrical and mechanical components.

## Electrical Components

[Insert final BOM table.]

Main electrical components include:

- 12 V, 6 A DC power supply
- Arduino Mega 2560
- RAMPS 1.4
- A4988 stepper drivers
- NEMA 17 stepper motors
- DMS15 servo motor
- ESP32-CAM
- FTDI adapter
- Logic-level converter
- Limit switches
- Buck converters
- USB cables and wiring

## Mechanical Components

[Insert final BOM table.]

Main mechanical components include:

- GT2 belts
- GT2 pulleys
- T8 lead screw
- Trapezoidal nut
- Smooth rods
- Linear bearings
- Axial ball bearings
- Deep groove ball bearings
- Couplers
- Screws and nuts
- MDF sheets
- PETG or PLA + TPU filament
- Aluminium rods for pegs

---

# Risk Assessment

Several risks should be considered during assembly and testing.

## Mechanical Risks

The motors may lack torque if the arm is fully extended or if acceleration is too high. To reduce this risk, conservative motion speeds and reduction ratios should be used.

The arm may lose position if stepper motors miss steps. Homing routines and limit switches help reset the robot to a known reference position.

The gripper may fail to hold disks reliably if the jaws are misaligned or if the gripping force is insufficient. Each disk size should be tested before full integration.

## Electrical Risks

The power supply must be able to handle simultaneous motor, servo, Arduino, and camera operation. Voltage rails should be tested before connecting all components.

Wiring may fail because of repeated motion around the joints. Cables should be routed with slack and protected using heat-shrink tubing.

## Software Risks

The inverse kinematics may become unstable near singular positions. The working area should be limited in software.

The camera may fail to detect disks under poor lighting or low contrast. Lighting and disk colors should be tested early.

The Hanoi solver must validate detected configurations before executing movements, especially if non-standard or intermediate states are supported.

## Collision Risks

The gripper may collide with the pegs or platform if calibration is inaccurate. All new movement sequences should first be tested slowly and with emergency stop access.

---
# Possible Improvements

[ A list of possible improvements here ]

---
# Top contributors:

This project was made by:

- Rania Hida ([@Rania5724](https://github.com/Rania5724))
- Mehdi Belhaj ([@mehdi754-hub](https://github.com/mehdi754-hub))
- Youssef Benhayoun Sadafi ([@youssef-9511](https://github.com/youssef-9511))
- Ozan Esref Sahingöz ([@ozan-sz](https://github.com/ozan-sz))
- Jonathan Nilsson Pilemand ([@JonathanPilemand](https://github.com/JonathanPilemand))
- Maha El Qabli ([@melqabli](https://github.com/melqabli))
- Davood Hashimi ([@Davood-H](https://github.com/Davood-H))