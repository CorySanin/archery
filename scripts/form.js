document.addEventListener('DOMContentLoaded', function () {
    for (let btn of document.getElementsByClassName('copybtn')) {
        btn.addEventListener('click', e => {
            navigator.clipboard.writeText(e.target.previousElementSibling.innerText);
        });
    }

    document.getElementById('persistChk')?.addEventListener('change', async e => {
        const sqid = document.getElementById('sqid').textContent;
        const persist = !!e.target?.checked;
        const resp = await fetch(`/build/${sqid}/persist`, {
            method: 'post',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ persist })
        });
        if (!resp.ok) {
            this.location.reload();
        }
    });
});
