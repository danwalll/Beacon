const revealBtn = document.getElementById("reveal");
const continueBtn = document.getElementById("continue");

revealBtn.addEventListener("click", async () => {
  revealBtn.disabled = true;
  await window.guide.revealInApplications();
  revealBtn.disabled = false;
});

continueBtn.addEventListener("click", async () => {
  continueBtn.disabled = true;
  await window.guide.dismiss();
});
