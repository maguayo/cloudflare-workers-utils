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
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PATCH, PUT",
                "Access-Control-Allow-Headers": "Content-Type, origin, content-type, accept",
            }
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
 * Returns the URL params of a given request url.
 * 
 * @param {*} request 
 * @returns 
 */
export function getParams(request){
    const params = {}
    const url = new URL(request.url)
    const queryString = url.search.slice(1).split('&')
  
    queryString.forEach(item => {
      const kv = item.split('=')
      if (kv[0]) params[kv[0]] = kv[1] || true
    })
  
    return params
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


/* 
* MultiPart_parse decodes a multipart/form-data encoded response into a named-part-map.
* The response can be a string or raw bytes.
*
* Usage for string response:
*      var map = MultiPart_parse(xhr.responseText, xhr.getResponseHeader('Content-Type'));
*
* Usage for raw bytes:
*      xhr.open(..);     
*      xhr.responseType = "arraybuffer";
*      ...
*      var map = MultiPart_parse(xhr.response, xhr.getResponseHeader('Content-Type'));
*
* Copyright@ 2013-2014 Wolfgang Kuehn, released under the MIT license.
*/
export function MultiPart_parse(body, contentType) {
    // Examples for content types:
    //      multipart/form-data; boundary="----7dd322351017c"; ...
    //      multipart/form-data; boundary=----7dd322351017c; ...
    var m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

    if (!m) {
        throw new Error('Bad content-type header, no multipart boundary');
    }

    let s, fieldName;
    let boundary = m[1] || m[2];

    function Header_parse(header) {
        var headerFields = {};
        var matchResult = header.match(/^.*name="([^"]*)"$/);
        if (matchResult) headerFields.name = matchResult[1];
            return headerFields;
    }

    function rawStringToBuffer(str) {
        var idx, len = str.length,
            arr = new Array(len);
        for (idx = 0; idx < len; ++idx) {
            arr[idx] = str.charCodeAt(idx) & 0xFF;
        }
        return new Uint8Array(arr).buffer;
    }

    // \r\n is part of the boundary.
    boundary = '\r\n--' + boundary;

    var isRaw = typeof(body) !== 'string';

    if (isRaw) {
        var view = new Uint8Array(body);
        s = String.fromCharCode.apply(null, view);
    } else {
        s = body;
    }

    // Prepend what has been stripped by the body parsing mechanism.
    s = '\r\n' + s;

    var parts = s.split(new RegExp(boundary)),
    partsByName = {};

    // First part is a preamble, last part is closing '--'
    for (var i = 1; i < parts.length - 1; i++) {
        var subparts = parts[i].split('\r\n\r\n');
        var headers = subparts[0].split('\r\n');
        for (var j = 1; j < headers.length; j++) {
            var headerFields = Header_parse(headers[j]);
            if (headerFields.name) {
                fieldName = headerFields.name;
            }
        }
    
        partsByName[fieldName] = isRaw ? rawStringToBuffer(subparts[1]) : subparts[1];
    }

    return partsByName;
}


export function Boundary_parse (body){
    var bndry = body.split('Content-Disposition: form-data;')[0];
    return bndry.trim().slice(2);
}


export {router}