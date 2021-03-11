import { default as router } from './router';
import {uuidv4, toSentryEvent, parseError} from './sentry'


/**
 * Response helper function
 * @param {*} res
 * @param {*} status
 * @param {*} statusText
 */
export function response(res, status = 200, statusText = 'OK', headers = {}) {
    if (typeof res === 'object') {
        var { status, statusText, headers } = res;
        res = res.res;
    }
    let newHeaders = new Headers(headers);
    newHeaders.set('X-CloudFlare-Worker', 'Served by CloudFlare Worker.');
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS, PUT, PATCH');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, origin, content-type, accept');

    // let text = (async () => {
    //     return await res.text();
    // })();

    // Modify it.
    //let modified = text + '<br/>More info here: <a href="https://github.com/anderly/cloudflare-worker-routing">https://github.com/anderly/cloudflare-worker-routing</a>';
    var response = new Response(res, { status: status, statusText: statusText, headers: newHeaders });
    console.log(response)
    return response;
}


/**
 * Response for CORS
 * 
 * @param {*} request 
 */
export function handleOptions(request) {
    if (request.headers.get("Origin") !== null &&
        request.headers.get("Access-Control-Request-Method") !== null &&
        request.headers.get("Access-Control-Request-Headers") !== null) {

        return new Response(null, {
            headers: constants.CORSHEADERS
        })
    } else {
        return new Response(null, {
            headers: {
                "Allow": "GET, HEAD, POST, OPTIONS",
            }
        })
    }
}


/**
 * Function to log an error in Sentry
 * 
 * @param {*} account 
 *  - RETRIES
 *  - SENTRY_PROJECT_ID
 *  - CLIENT_NAME
 *  - CLIENT_VERSION
 *  - SENTRY_KEY
 *  - TAGS
 *  - ENV
 *  - SERVER_NAME
 *  - RELEASE
 *  - APP
 * @param {*} err 
 * @param {*} request 
 * @param {*} data 
 */
export async function log(account, err, request, data=null) {
    const body = JSON.stringify(toSentryEvent(account, err, request, data))

    for (let i = 0; i <= account.RETRIES; i++) {
        const res = await fetch(`https://sentry.io/api/${account.SENTRY_PROJECT_ID}/store/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Sentry-Auth': [
            'Sentry sentry_version=7',
            `sentry_client=${account.CLIENT_NAME}/${account.CLIENT_VERSION}`,
            `sentry_key=${account.SENTRY_KEY}`,
            ].join(', '),
        },
        body,
        })
        if (res.status === 200) {
        return
        }
        // We couldn't send to Sentry, try to log the response at least
        console.error({ httpStatus: res.status, ...(await res.json()) }) // eslint-disable-line no-console
    }
}

/**
 * Returns the request ready to be send to Stripe API.
 * 
 * @param {*} data 
 * @param {*} method 
 * @param {*} stripeKey 
 */
export function prepareStripePayload(data, method, stripeKey){
    let queryString = Object.keys(data).map(key => key + '=' + data[key]).join('&');
    let payload = {
        method: method,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Bearer ' + stripeKey
        },
    }
    if(method !== 'GET'){
        payload["body"] = queryString
    }
    return payload
}


/**
 * Since Stripe has a limit on the fields we can not send the full orderlines,
 * thats why we send them as {"ID_PRODUCT": NUMBER}, as a backup in case we lose
 * some information, this is not a default way of recovering the data, its just
 * an extra backup just to be safe.
 * 
 * @param {*} orderlines 
 */
export function transformOrderlinesToStripeFormat(orderlines){
    let result = {}
    if(orderlines){
        for(let i = 0; i < orderlines.length; i++){
            result[orderlines[i].id] = orderlines[i].number
        }
    }
    return JSON.stringify(result)
}


/**
 * Creates a valid celery task object.
 * 
 * @param {*} taskPath 
 * @param {*} taskBody 
 */
export function prepareCeleryPayload(taskPath, taskBody){
    let taskId = uuidv4();

    let body = [
        [taskBody],
        {},
        {"callbacks": null, "errbacks": null, "chain": null, "chord": null}
    ]

    let properties = {
        "correlation_id": taskId,
        "reply_to": uuidv4(),
        "delivery_mode": 2,
        "delivery_info": {
            "exchange": "",
            "routing_key": "default"
        },
        "priority": 0,
        "body_encoding": "base64",
        "delivery_tag": uuidv4()
    }

    let headers = {
        "lang": "py",
        "task": taskPath,
        "id": taskId,
        "shadow": null,
        "eta": null,
        "expires": null,
        "group": null,
        "retries": 0,
        "timelimit": [null, null],
        "root_id": taskId,
        "parent_id": null,
        "argsrepr": "({},)",
        "kwargsrepr": "{}",
        "origin": "gen21089@cloudflareworkers"
    }

    let payload = {
        "body": Buffer.from(JSON.stringify(body)).toString("base64"),
        "content-encoding": "utf-8",
        "content-type": "application/json",
        "headers": headers,
        "properties": properties
    }


    let encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64")

    return encodedPayload
}


/**
 * AWS Credential Provider
 * 
 * @param {*} AWS_ACCESS_KEY_ID 
 * @param {*} AWS_SECRET_ACCESS_KEY 
 */
export async function AWSCredentialProvider(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) {
    return {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    }
}


/**
 * Prepares a celert task to be send to AWS but is not send yet, you have to 
 * use "createCeleryTask" later.
 * 
 * @param {*} AWS_SQS_URL 
 * @param {*} taskPath 
 * @param {*} taskBody 
 */
export function AWSPrepareSQSTask(AWS_SQS_URL, taskPath, taskBody){
    let encodedPayload = prepareCeleryPayload(taskPath, taskBody)

    const sendData = new SendMessageCommand({
        // use wrangler secrets to provide this global variable
        QueueUrl: AWS_SQS_URL,
        MessageBody: encodedPayload
    });
    return sendData;
}


/**
 * Send a Celery task to AWS SQS
 * 
 * @param {*} AWS_SQS_URL 
 * @param {*} taskPath 
 * @param {*} taskBody 
 */
export async function createCeleryTask(AWS_SQS_URL, taskPath, taskBody){
    const client = new SQSClient({
        region: "eu-west-3",
        credentialDefaultProvider: myCredentialProvider
    });

    const sendData = AWSPrepareSQSTask(AWS_SQS_URL, taskPath, taskBody)

    let data = await client.send(sendData);
    return data
}


export {router}