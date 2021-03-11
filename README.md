# Cloudflare Workers Utils

Some functions that I usually use in my projects, like logging to Sentry, create AWS SQS Celery tasks, format responses, routing...


## Installation

```
npm install --save cloudflare-workers-utils
```

## Usage

### response
```
import {response} from 'cloudflare-workers-utils'

let res = {
    res: JSON.stringify({"error": "Internal Server Error"}),
    status: 500,
    headers: { 'content-type': 'application/json' },
};
return response(res);
```