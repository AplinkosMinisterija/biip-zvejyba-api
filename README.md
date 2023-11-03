# BĮIP Žvejyba API

[![License](https://img.shields.io/github/license/AplinkosMinisterija/biip-zvejyba-api)](https://github.com/AplinkosMinisterija/biip-zvejyba-api/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/AplinkosMinisterija/biip-zvejyba-api)](https://github.com/AplinkosMinisterija/biip-zvejyba-api/issues)
[![GitHub stars](https://img.shields.io/github/stars/AplinkosMinisterija/biip-zvejyba-api)](https://github.com/AplinkosMinisterija/biip-zvejyba-api/stargazers)

This repository contains the source code and documentation for the BĮIP Žvejyba API, developed by the Aplinkos
Ministerija.

## Table of Contents

- [About the Project](#about-the-project)
- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Usage](#usage)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## About the Project

The BĮIP Žvejyba API is designed to provide information and functionalities related to activities of commercial fishing
events. It aims to support the management of commercial fishings.

## Getting Started

To get started with the BĮIP Žvejyba API, follow the instructions below.

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/AplinkosMinisterija/biip-zvejyba-api.git
   ```

2. Install the required dependencies:

   ```bash
   cd biip-zvejyba-api
   yarn install
   ```

### Usage

1. Set up the required environment variables. Copy the `.env.example` file to `.env` and provide the necessary values
   for the variables.

2. Start the API server:

   ```bash
   yarn dc:up
   yarn dev
   ```

The API will be available at `http://localhost:3000/zvejyba`.

## Deployment

### Production

To deploy the application to the production environment, create a new GitHub release:

1. Go to the repository's main page on GitHub.
2. Click on the "Releases" tab.
3. Click on the "Create a new release" button.
4. Provide a version number, such as `1.2.3`, and other relevant information.
5. Click on the "Publish release" button.

### Staging

The `main` branch of the repository is automatically deployed to the staging environment. Any changes pushed to the main
branch will trigger a new deployment.

### Development

To deploy any branch to the development environment use the `Deploy to Development` GitHub action.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a
pull request. For more information, see
the [contribution guidelines](https://github.com/AplinkosMinisterija/.github/blob/main/CONTRIBUTING.md).

## License

This project is licensed under the [MIT License](./LICENSE).
