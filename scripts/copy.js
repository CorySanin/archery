document.addEventListener('DOMContentLoaded', function () {
    for (let btn of document.getElementsByClassName('copybtn')) {
        btn.addEventListener('click', e => {
            navigator.clipboard.writeText(e.target.previousElementSibling.innerText);
        });
    }
});
