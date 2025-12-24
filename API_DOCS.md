# Interface VDC API Documentation

This document provides details about the API endpoints available in the Interface VDC application.

## Base URL

All endpoints are relative to the base URL where the server is hosted.
Default local development URL: `http://localhost:3000`

## Authentication

Most endpoints require a JSON Web Token (JWT) for authentication.
You must include the token in the `Authorization` header of your requests.

**Header Format:**
```
Authorization: Bearer <your_access_token>
```

To obtain a token, use the `/api/login` endpoint.

---

## Endpoints

### 1. Authentication

#### Login
Authenticate a user and retrieve an access token.

- **URL**: `/api/login`
- **Method**: `POST`
- **Auth Required**: No
- **Body Parameters**:
    - `username` (string, required): The username.
    - `password` (string, required): The password.
- **Response**:
    - **Success (200 OK)**:
      ```json
      {
        "message": "Login successful...",
        "accessToken": "eyJhbGciOiJIUzI1Ni...",
        "user": { "id": 1, "username": "admin", "role": "active_api" }
      }
      ```
    - **Error (401 Unauthorized)**: Invalid credentials.

---

### 2. Vehicle Management

#### Get Vehicle Status by VIN
Retrieves the status of a vehicle by its VIN number.

- **URL**: `/api/vehicle_no/:vin_number`
- **Method**: `GET`
- **Auth Required**: Yes
- **URL Parameters**:
    - `vin_number` (string, required): The VIN number to search.
- **Response**:
    - **Success (200 OK)**:
      ```json
      {
        "status": 1, // 1 = Waiting Receive, 2 = Received
        "vehicle_number": "VIN12345",
        "vehicle_code": "VC001",
        "engine_code": "ENG001",
        "ga_off_time": "2023-01-01T10:00:00.000Z",
        "pdiin_flg": 0,
        "message": "Waiting Receive"
      }
      ```
    - **Not Found (404 Not Found)**:
      ```json
      {
        "status": 0,
        "vin_number": "VIN12345",
        "message": "No Data"
      }
      ```

#### Update Receiving Status (PDI In)
Updates the PDI In flag (`pdiin_flg`) for a vehicle.

- **URL**: `/api/receiving`
- **Method**: `POST`
- **Auth Required**: Yes
- **Body Parameters**:
    - `vin_number` (string, required): The VIN number.
    - `pdiin_flg` (number, required): Status flag (`0` or `1`).
    - `date_time` (string, required): Timestamp (Format: `YYYY/MM/DD HH:mm:ss`).
- **Response**:
    - **Success (200 OK)**:
      ```json
      {
        "status": 1,
        "message": "Successfully updated pdiin_flg to 1...",
        "currentPdiinFlg": 0,
        "rows_affected": 1,
        "received_at": "2023-12-16 10:00:00"
      }
      ```
    - **Conflict (409 Conflict)**: Vehicle already received.

#### Update Delivery Status
Updates the Delivery flag (`delivery_flg`) for a vehicle.

- **URL**: `/api/delivery`
- **Method**: `POST`
- **Auth Required**: Yes
- **Body Parameters**:
    - `vin_number` (string, required): The VIN number.
    - `date_time` (string, required): Timestamp (Format: `YYYY/MM/DD HH:mm:ss`).
- **Response**:
    - **Success (200 OK)**:
      ```json
      {
        "status": 1,
        "message": "Successfully updated delivery_flg to 1...",
        "vin_number": "VIN12345",
        "delivery_at": "2023-12-16 12:00:00"
      }
      ```
    - **Status 2 (200 OK)**: Already delivered.
    - **Status 3 (200 OK)**: Waiting for receive (Cannot deliver yet).

---

### 3. System & Sync

#### Manual GA-Off Sync
Manually triggers the synchronization process with the external system (Anji Logistics).

- **URL**: `/api/gaoff`
- **Method**: `POST`
- **Auth Required**: Yes
- **Response**:
    - **Success (200 OK)**:
      ```json
      {
        "message": "Sync process completed.",
        "total_found": 5,
        "success_count": 5,
        "error_count": 0,
        "db_updated_rows": 5,
        "details": { ... }
      }
      ```

#### Health Check
Checks if the server is running.

- **URL**: `/`
- **Method**: `GET`
- **Auth Required**: No
- **Response**: HTML content.
