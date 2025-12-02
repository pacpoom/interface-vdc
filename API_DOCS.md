# Interface VDC API Documentation

This document provides details about the API endpoints available in the Interface VDC application.

## Base URL

All endpoints are relative to the base URL where the server is hosted.
Default local development URL: `http://localhost:3000`

## Endpoints

### 1. Home / Health Check

Checks if the server is running.

- **URL**: `/`
- **Method**: `GET`
- **Description**: Returns a simple HTML message indicating the server is running and provides instructions for testing other endpoints.
- **Response**: HTML content.

### 2. Test Database Connection

Tests the connection to the MySQL database and retrieves sample data.

- **URL**: `/api/testdb`
- **Method**: `GET`
- **Description**: Attempts to fetch the first 5 rows from a table named `users`. This is primarily for debugging and verifying database connectivity.
- **Response**:
    - **Success (200 OK)**:
      ```json
      {
        "message": "Data fetched successfully from MySQL!",
        "data": [ ... ]
      }
      ```
    - **Error (500 Internal Server Error)**:
      ```json
      {
        "error": "Failed to fetch data...",
        "details": "Error message details"
      }
      ```

### 3. Get Vehicle Number by VIN

Retrieves the vehicle serial number associated with a specific VIN number.

- **URL**: `/api/vehicle_no/:vin_number`
- **Method**: `GET`
- **Description**: Queries the `gcms_gaoff` table to find the `serial_number` corresponding to the provided `vin_number`.
- **URL Parameters**:
    - `vin_number` (Required): The VIN number of the vehicle to search for.
- **Response**:
    - **Success (200 OK)**:
      ```json
      {
        "message": "Vehicle number (serial_number) fetched successfully.",
        "vin_number": "PROVIDED_VIN",
        "vehicle_no": "FOUND_SERIAL_NUMBER"
      }
      ```
    - **Not Found (404 Not Found)**:
      ```json
      {
        "message": "No vehicle number (serial_number) found for the given VIN number.",
        "vin_number": "PROVIDED_VIN"
      }
      ```
    - **Bad Request (400 Bad Request)**:
      ```json
      {
        "error": "VIN number is required in the path."
      }
      ```
    - **Error (500 Internal Server Error)**:
      ```json
      {
        "error": "Internal Server Error while querying the database.",
        "details": "Error message details"
      }
      ```
