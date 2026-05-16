# Hardware Setup Guide

## Overview

The PetCare IoT platform integrates with physical hardware devices for pet monitoring and care automation. This guide covers the setup and configuration of ESP32-based smart collars and Raspberry Pi 5 central stations.

## System Components

### 1. ESP32 Smart Collar
A wearable device that monitors pet health and location.

**Components:**
- ESP32-WROOM-32 microcontroller
- MAX30102 heart rate sensor
- MPU6050 accelerometer/gyroscope
- NEO-6M GPS module
- LiPo battery (3.7V, 1000mAh)
- Charging circuit (TP4056)

**Features:**
- Real-time heart rate monitoring
- Activity tracking (steps, active minutes)
- GPS location tracking
- Battery level monitoring
- OTA firmware updates

### 2. Raspberry Pi 5 Central Station
A stationary hub that manages feeding, water, and camera functions.

**Components:**
- Raspberry Pi 5 (4GB or 8GB)
- Camera Module 3 (or compatible USB camera)
- Peristaltic pump (for water dispensing)
- Servo motor (for food dispensing)
- Load cell (for weight measurement)
- 5V power supply

**Features:**
- Automated feeding schedules
- Water level monitoring and dispensing
- Live camera streaming (HLS)
- Weight-based food measurement
- Local processing and MQTT communication

## ESP32 Collar Setup

### Hardware Assembly

1. **Connect Sensors to ESP32:**

| Sensor | ESP32 Pin |
|--------|-----------|
| MAX30102 SDA | GPIO 21 |
| MAX30102 SCL | GPIO 22 |
| MPU6050 SDA | GPIO 21 |
| MPU6050 SCL | GPIO 22 |
| NEO-6M TX | GPIO 16 |
| NEO-6M RX | GPIO 17 |
| Battery ADC | GPIO 34 |

2. **Power Management:**
   - Connect LiPo battery to TP4056 charging module
   - Connect TP4056 output to ESP32 VIN and GND
   - Add power switch between battery and module

### Firmware Setup

```cpp
// Required libraries
#include <WiFi.h>
#include <MQTT.h>
#include <TinyGPS++.h>
#include <Wire.h>
#include <MAX30105.h>
#include <MPU6050.h>

// Configuration
#define MQTT_BROKER "your-broker-ip"
#define MQTT_PORT 1883
#define MQTT_USER "petcare"
#define MQTT_PASS "your-password"
#define DEVICE_ID "collar-001"
#define PET_ID "pet-123"
```

### Firmware Upload

1. Install Arduino IDE or PlatformIO
2. Add ESP32 board support
3. Install required libraries
4. Configure WiFi and MQTT settings
5. Upload firmware via USB

### Calibration

```cpp
// Heart rate calibration
void calibrateHeartRate() {
  // Place sensor on stable surface
  // Take 100 readings
  // Calculate baseline
}

// Accelerometer calibration
void calibrateAccelerometer() {
  // Place device flat
  // Zero out gravity component
}
```

## Raspberry Pi Station Setup

### Hardware Assembly

1. **Camera Setup:**
   - Connect Camera Module 3 to CSI port
   - Enable camera in `raspi-config`
   - Test with `libcamera-hello`

2. **Pump Control:**
   - Connect peristaltic pump to relay module
   - Connect relay to GPIO pin (e.g., GPIO 17)
   - Connect pump tubing to water reservoir

3. **Food Dispenser:**
   - Mount servo motor to food container
   - Connect servo to GPIO pin (e.g., GPIO 18)
   - Calibrate servo angles for portion sizes

4. **Weight Scale:**
   - Connect load cell to HX711 ADC
   - Connect HX711 to GPIO pins
   - Calibrate with known weights

### Software Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3-pip python3-venv mosquitto-clients

# Create virtual environment
python3 -m venv /opt/petcare-station
source /opt/petcare-station/bin/activate

# Install Python packages
pip install paho-mqtt RPi.GPIO hx711 adc

# Clone station code
git clone https://github.com/your-org/petcare-station.git
cd petcare-station

# Configure
cp .env.example .env
nano .env  # Edit with your settings

# Install as service
sudo cp petcare-station.service /etc/systemd/system/
sudo systemctl enable petcare-station
sudo systemctl start petcare-station
```

### Camera Streaming Setup

```bash
# Install GStreamer or use libcamera
sudo apt install -y gstreamer1.0-tools gstreamer1.0-plugins-base

# Test camera
libcamera-hello --timeout 5000

# Start HLS stream
libcamera-vid -t 0 --codec h264 --width 1280 --height 720 \
  --output /dev/shm/camera.h264 --listen
```

## MQTT Configuration

### Device Authentication

Create MQTT credentials for each device:

```bash
# On MQTT broker (Mosquitto)
sudo mosquitto_passwd -c /etc/mosquitto/passwd collar-001
# Enter password when prompted

# Restart mosquitto
sudo systemctl restart mosquitto
```

### Topic Permissions

Configure ACL in `/etc/mosquitto/acl.conf`:

```
# Collar devices
user collar-001
topic write telemetry/collar-001/data
topic read device/collar-001/command

# Station
user station-001
topic write feeding/station-001/completed
topic write device/station-001/water/refill
topic read device/station-001/command
```

## Testing

### Test ESP32 Collar

```bash
# Subscribe to telemetry topic
mosquitto_sub -h broker-ip -t "telemetry/collar-001/data" -v

# Expected output:
# telemetry/collar-001/data {"deviceId":"collar-001","petId":"pet-123","heartRate":85,"activity":42}
```

### Test Raspberry Pi Station

```bash
# Subscribe to feeding topic
mosquitto_sub -h broker-ip -t "feeding/station-001/completed" -v

# Publish manual feed command
mosquitto_pub -h broker-ip -t "device/station-001/command" \
  -m '{"command":"feed","amount":50}'
```

### Test Camera Stream

```bash
# Check if stream is running
curl -I http://raspberrypi:8888/hls/index.m3u8

# Should return HTTP 200
```

## Troubleshooting

### ESP32 Issues

| Issue | Solution |
|-------|----------|
| WiFi connection fails | Check SSID/password, ensure 2.4GHz network |
| Sensor not detected | Check I2C wiring, verify pull-up resistors |
| GPS no fix | Ensure clear sky view, wait for cold start |
| Battery drains fast | Reduce telemetry frequency, check sleep mode |

### Raspberry Pi Issues

| Issue | Solution |
|-------|----------|
| Camera not detected | Run `sudo raspi-config`, enable camera |
| Pump not working | Check relay wiring, GPIO pin configuration |
| MQTT disconnects | Check broker address, network connectivity |
| Stream lag | Reduce resolution, increase keyframe interval |

## Safety Considerations

1. **Electrical Safety:**
   - Use appropriate wire gauges for current
   - Include fuses for battery circuits
   - Isolate mains voltage from low voltage

2. **Pet Safety:**
   - Ensure collar is not too tight (2-finger rule)
   - Use pet-safe materials for all contact surfaces
   - Monitor for skin irritation

3. **Water Safety:**
   - Use food-grade tubing for water system
   - Include backflow prevention
   - Regular cleaning to prevent bacteria growth

## Maintenance

### Daily
- Check battery levels
- Verify water reservoir level
- Review telemetry data for anomalies

### Weekly
- Clean camera lens
- Check collar fit and condition
- Calibrate weight scale

### Monthly
- Replace water filters
- Inspect all connections
- Update firmware if available

## Resources

- [ESP32 Documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/)
- [Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/)
- [MQTT Protocol](https://mqtt.org/)
- [PetCare GitHub](https://github.com/hazemzammit/Esprit-PI-4IoSyS-2026-PetCare)