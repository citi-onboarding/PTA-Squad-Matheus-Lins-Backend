## Purpose

Define the account records that the DistriLux user seed will populate and that future portfolio authorization will use.

## ADDED Requirements

### Requirement: Persist user account identity

The portal SHALL store an account with a generated integer ID, name, unique login email, password hash, role, and creation timestamp. Supported roles SHALL be SELLER, MANAGER, FINANCE, and ADMIN. The account record SHALL store only a password hash as the password representation. F02 (US-002), RN-08.

#### Scenario: Store an account

- **WHEN** an account is created with a new email, name, password hash, and supported role
- **THEN** the account can be retrieved with those values, a generated ID, and a populated creation timestamp

#### Scenario: Reject a duplicate login email

- **WHEN** another account is created with an existing login email
- **THEN** the write is rejected and the original account is retained

### Requirement: Represent seller portfolio association

The portal SHALL represent an assigned seller portfolio through a seller code that matches the code stored on customer records. The seller code SHALL be nullable and is reserved for the SELLER role. F02 (US-002), RN-08.

#### Scenario: Store a seller account with an assigned portfolio

- **WHEN** a seller account is saved with a code also present on customer records
- **THEN** the same code is readable on the account and those customer records

#### Scenario: Store an account without a seller code

- **WHEN** a manager, finance, or admin account is created without a seller code
- **THEN** the account is stored with a null seller code
