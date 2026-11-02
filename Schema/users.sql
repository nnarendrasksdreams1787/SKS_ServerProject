CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reference_id VARCHAR(20) UNIQUE,
    document_type ENUM('PAN', 'ADDHAAR') NOT NULL,
    document_number VARCHAR(12) NOT NULL,

    full_name VARCHAR(150) NOT NULL,
    mobile_no VARCHAR(15) NOT NULL,
    date_of_birth DATE NOT NULL,

    gender ENUM(
        'Male',
        'Female',
        'Other',
        'Prefer not to say'
    ) NOT NULL,

    pincode VARCHAR(10) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    address VARCHAR(500) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);