(() => {
  const topbar = document.querySelector('[data-topbar]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('.desktop-nav');
  const toast = document.querySelector('[data-toast]');
  const toastText = document.querySelector('[data-toast-text]');
  let toastTimer;

  const announce = (message) => {
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  };

  window.addEventListener('scroll', () => {
    topbar?.classList.toggle('scrolled', window.scrollY > 18);
  }, { passive: true });

  menuToggle?.addEventListener('click', () => {
    const isOpen = nav?.classList.toggle('is-open') ?? false;
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });

  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      nav?.classList.remove('is-open');
      menuToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      document.querySelectorAll('.nav-link').forEach((link) => {
        link.classList.toggle('is-active', link.dataset.navTarget === id);
      });
    });
  }, { rootMargin: '-35% 0px -54% 0px', threshold: 0 });
  ['studio', 'memory', 'branches', 'skills'].forEach((id) => {
    const section = document.getElementById(id);
    if (section) sectionObserver.observe(section);
  });

  document.querySelectorAll('[data-demo-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.demoTab;
      document.querySelectorAll('[data-demo-tab]').forEach((item) => item.classList.toggle('is-active', item === tab));
      document.querySelectorAll('[data-demo-panel]').forEach((panel) => panel.classList.toggle('is-visible', panel.dataset.demoPanel === name));
    });
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'rewrite') {
        const target = document.querySelector('.reader-highlight');
        if (target) target.textContent = '他没有松开钥匙，只向她走近了一步。“带路。”';
        button.textContent = '已生成另一个版本 ✓';
        button.classList.add('is-complete');
        announce('已生成一个新的 What-if 版本');
      }
      if (action === 'continue') announce('续写草稿已准备好，可以继续编辑');
      if (action === 'search' || action === 'search-result') announce('找到 3 个相关段落，最匹配第 01 章');
      if (action === 'graph') announce('图谱视图已打开：34 个节点，51 条关系');
      if (action === 'context') announce('高级上下文已进入可编辑模式');
      if (action === 'branch') {
        document.querySelector('.timeline-card.selected')?.classList.toggle('pulse-card');
        announce('已切换到「林舟决定一起赴约」分支');
      }
      if (action === 'future-jump') announce('正在桥接第 03 章 → 第 08 章的 5 个关键事件');
      if (action === 'roleplay') {
        const response = document.querySelector('[data-roleplay-response] p');
        const label = document.querySelector('[data-roleplay-response] small');
        if (response) response.textContent = '“因为这一次，我想让你知道，门后面不只有一条路。”';
        if (label) label.textContent = '沈遥 · 刚刚';
        announce('沈遥回应了你的台词');
      }
      if (action === 'roleplay-reset') announce('场景选择器已准备好');
      if (action === 'skill') announce('技能卡提炼任务已加入队列');
    });
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', () => {
      const targetId = link.getAttribute('href');
      if (targetId === '#top') window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
