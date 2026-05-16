document.addEventListener('DOMContentLoaded', function () {
    const followLogsBtn = this.getElementById('followCheckmark');

    function handleScrollToggleClick() {
        window.scrollTo(0, followLogsBtn.checked ? document.body.scrollHeight : 0);
    }

    followLogsBtn.checked = false;
    followLogsBtn.addEventListener('change', handleScrollToggleClick);
});
