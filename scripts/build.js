document.addEventListener('DOMContentLoaded', function () {
    const logContainer = this.getElementById('logs');
    const followLogsBtn = this.getElementById('followCheckmark');
    const buildStatusTxt = this.getElementById('buildStatus');
    let started = logContainer.childElementCount > 0;

    /**
     * Add log line to the DOM
     * @param {string[]} str 
     */
    function appendLines(str, e = false) {
        str.forEach(line => {
            const p = document.createElement('p');
            p.appendChild(document.createTextNode(line));
            logContainer.appendChild(p);
        });
    }

    /**
     * Scroll to bottom of page if checkbox is checked
     */
    function scrollToBottom() {
        if (followLogsBtn.checked) {
            window.scrollTo(0, document.body.scrollHeight);
        }
    }

    function handleScrollToggleClick() {
        window.scrollTo(0, followLogsBtn.checked ? document.body.scrollHeight : 0);
    }

    /**
     * Split string by newline char
     * @param {string} str 
     */
    function splitLines(str) {
        return str.split('\n').map(line => line.substring(line.lastIndexOf('\r') + 1));
    }

    /**
     * Establish websocket connection
     */
    function connect() {
        const loc = window.location;
        let new_uri = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        new_uri += "//" + loc.host;
        new_uri += loc.pathname + 'ws';
        var ws = new WebSocket(new_uri);

        ws.onmessage = function (message) {
            const buildEvent = JSON.parse(message.data);

            if (!started) {
                started = true;
                buildStatusTxt.replaceChild(document.createTextNode('running'), buildStatusTxt.firstChild);
            }
            if (buildEvent.type === 'finish') {
                ws.close();
                buildStatusTxt.replaceChild(document.createTextNode(buildEvent.message), buildStatusTxt.firstChild);
                appendLines([`finished: ${buildEvent.message}`]);
                const cancelBtn = document.getElementById('cancelRow');
                cancelBtn.parentElement.removeChild(cancelBtn);
            }
            else {
                appendLines(splitLines(buildEvent.message), buildEvent.type === 'err');
                scrollToBottom();
            }
        }
    }

    connect();
    followLogsBtn.checked = false;
    followLogsBtn.addEventListener('change', handleScrollToggleClick);
});