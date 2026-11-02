const SMS_NOT_CONFIGURED = "SMS_NOT_CONFIGURED";

/*
 * SMS provider integration will be added when the provider
 * and credintials are supplied by the team
 * 
 * Do not log reset links or tokens.

*/

function isConfigured() {
    // Change only after a real provider adapter is implemented and configured.
    return false;
}

async function sendSms (to, message) {
    // if (!process.env.SMS_PROVIDER) {
    //     const error = new Error(SMS_NOT_CONFIGURED);
    //     error.code = SMS_NOT_CONFIGURED;
    //     throw error;
    // }

    // Provide-specified API integration goes here.
    // Do not pretend delivery succeeded without calling the provider.

    // throw new Error (
    //     "SMS provider adapter has not been implemented."
    // )

    if (!isConfigured()) {
        const error = new Error(SMS_NOT_CONFIGURED);
        error.code = SMS_NOT_CONFIGURED;
        throw error;
    }

    throw new Error("SMS provider adapter has not been implemented.")
}

module.exports = {
    sendSms,
    isConfigured,
    SMS_NOT_CONFIGURED,
}