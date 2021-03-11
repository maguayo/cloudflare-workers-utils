export function uuidv4() {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    return [...bytes].map(b => ('0' + b.toString(16)).slice(-2)).join('') // to hex
}

export function toSentryEvent(account, err, request, data) {
    const errType = err.name || (err.contructor || {}).name
    const frames = parseError(err)
    const extraKeys = Object.keys(err).filter(key => !['name', 'message', 'stack'].includes(key))
    let result = {
        event_id: uuidv4(),
        message: errType + ': ' + (err.message || '<no message>'),
        exception: {
        values: [
            {
            type: errType,
            value: err.message,
            stacktrace: frames.length ? { frames: frames.reverse() } : undefined,
            },
        ],
        },
        extra: extraKeys.length
        ? {
            [errType]: extraKeys.reduce((obj, key) => ({ ...obj, [key]: err[key] }), {}),
            }
        : undefined,
        tags: account.TAGS,
        platform: 'javascript',
        environment: account.ENV,
        server_name: account.SERVER_NAME,
        timestamp: Date.now() / 1000,
        request:
        request && request.url
            ? {
                method: request.method,
                url: request.url,
                query_string: request.query,
                headers: request.headers,
                data: data,
            }
            : undefined,
        release: account.RELEASE,
    }
    return result
}

export function parseError(err) {
    return (err.stack || '')
        .split('\n')
        .slice(1)
        .map(line => {
        if (line.match(/^\s*[-]{4,}$/)) {
            return { filename: line }
        }

        // From https://github.com/felixge/node-stack-trace/blob/1ec9ba43eece124526c273c917104b4226898932/lib/stack-trace.js#L42
        const lineMatch = line.match(/at (?:(.+)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?/)
        if (!lineMatch) {
            return
        }

        return {
            function: lineMatch[1] || undefined,
            filename: lineMatch[2] || undefined,
            lineno: +lineMatch[3] || undefined,
            colno: +lineMatch[4] || undefined,
            in_app: lineMatch[5] !== 'native' || undefined,
        }
        })
        .filter(Boolean)
}