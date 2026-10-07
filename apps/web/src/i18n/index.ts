import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  'zh-CN': {
    translation: {
      app: { title: '校园值周管理', subtitle: 'Class Duty Management System' },
      auth: { login: '登录', logout: '退出', username: '用户名', password: '密码', loginLoading: '登录中...', passwordPlaceholder: '请输入密码', usernamePlaceholder: '请输入用户名', testAccounts: '测试账号（密码均为 123456）：' },
      nav: { dashboard: '看板', records: '值周记录', stats: '统计排名', summary: '每日小结', appeals: '申诉管理', awards: '流动红旗', config: '配置中心', settings: '系统设置', bigscreen: '大屏' },
      roles: { admin: '管理员', teacher: '教师', student: '值周生' },
      common: { save: '保存', cancel: '取消', delete: '删除', edit: '编辑', create: '创建', refresh: '刷新', search: '搜索', export: '导出', import: '导入', confirm: '确认', submit: '提交', loading: '加载中...', noData: '暂无数据', back: '返回', close: '关闭', all: '全部' },
      dashboard: { todayRecords: '今日记录', todayPositive: '今日加分', todayNegative: '今日扣分', weekBest: '本周最优', weekTop5: '本周排名 Top 5', recentRecords: '最新记录' },
      records: { title: '值周记录', newRecord: '新增记录', quickTemplate: '快速模板', class: '班级', week: '周次', tag: '评价标签', score: '分数', tagDefaultScore: '标签默认分', comment: '文字说明', commentPlaceholder: '例：3楼走廊卫生整洁...', uploadImage: '点击上传图片', maxImages: '最多9张', filterByWeek: '按周筛选', filterByClass: '按班级筛选', recordList: '记录列表', status: { normal: '正常', revoked: '已撤回', appealing: '申诉中', approved: '申诉通过' }, revoke: '撤回', appeal: '申诉', appealReason: '请输入申诉理由：', confirmRevoke: '确认撤回此记录？' },
      stats: { title: '统计排名', ranking: '班级排名', trend: '趋势图', detail: '明细', exportCSV: '导出 CSV', selectClass: '请选择班级', selectGrade: '全部年级', recentTrend: '近8周趋势' },
      summary: { title: '每日小结', newSummary: '新增小结', date: '日期', content: '小结内容（支持 Markdown）', autoHint: '留空将自动生成本周排名摘要...', historySummaries: '历史小结', autoContent: '今日无值周记录。', weekRanking: '{week} 周排名' },
      appeals: { title: '申诉管理', allStatus: '全部状态', pending: '待审批', approved: '已批准', rejected: '已驳回', teacher: '申诉人', reason: '申诉理由', reviewer: '审批人', approve: '批准', reject: '驳回', reviewComment: '已审批通过', rejectComment: '已驳回' },
      awards: { title: '流动红旗', awardButton: '颁发流动红旗', awarding: '评选中...', confirmAward: '确认为 {week} 颁发流动红旗？将自动评选各年级最高分班级。', noRecords: '暂无流动红旗记录，点击上方按钮自动评选', awardedAt: '颁发时间' },
      config: { title: '配置中心', tabs: { campuses: '校区', grades: '年级', classes: '班级', users: '用户', groups: '值周小组', tags: '标签', templates: '模板' }, newItem: '新增', editItem: '编辑', deleteConfirm: '确认删除？' },
      settings: { title: '系统设置', campusSettings: '第一校区设置', appealToggle: '申诉功能', appealDesc: '开启后班主任可对值周记录发起申诉', notifyToggle: '自动通知教师', notifyDesc: '每日小结自动推送给相关教师', enabled: '已开启', disabled: '已关闭', importTemplates: '导入模板', exportTemplates: '导出模板' },
      bigscreen: { title: '校园值周数字大屏', todayRecords: '今日记录', todayPositive: '今日加分', todayNegative: '今日扣分', bestClass: '最优班级', weekRankingTop10: '本周排名 Top 10', liveFeed: '实时记录滚动' },
    },
  },
  en: {
    translation: {
      app: { title: 'Class Duty Management', subtitle: 'Class Duty Management System' },
      auth: { login: 'Sign In', logout: 'Sign Out', username: 'Username', password: 'Password', loginLoading: 'Signing in...', passwordPlaceholder: 'Enter password', usernamePlaceholder: 'Enter username', testAccounts: 'Test accounts (password: 123456):' },
      nav: { dashboard: 'Dashboard', records: 'Duty Records', stats: 'Statistics', summary: 'Daily Summary', appeals: 'Appeals', awards: 'Red Flag', config: 'Configuration', settings: 'Settings', bigscreen: 'Big Screen' },
      roles: { admin: 'Admin', teacher: 'Teacher', student: 'Prefect' },
      common: { save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', create: 'Create', refresh: 'Refresh', search: 'Search', export: 'Export', import: 'Import', confirm: 'Confirm', submit: 'Submit', loading: 'Loading...', noData: 'No data', back: 'Back', close: 'Close', all: 'All' },
      dashboard: { todayRecords: 'Today Records', todayPositive: 'Today Positive', todayNegative: 'Today Negative', weekBest: 'Best Class', weekTop5: 'Weekly Top 5', recentRecords: 'Recent Records' },
      records: { title: 'Duty Records', newRecord: 'New Record', quickTemplate: 'Templates', class: 'Class', week: 'Week', tag: 'Tag', score: 'Score', tagDefaultScore: 'Tag Default', comment: 'Comment', commentPlaceholder: 'e.g. Clean hallway on 3F...', uploadImage: 'Click to upload', maxImages: 'Max 9 images', filterByWeek: 'Filter by Week', filterByClass: 'Filter by Class', recordList: 'Record List', status: { normal: 'Active', revoked: 'Revoked', appealing: 'Appealing', approved: 'Approved' }, revoke: 'Revoke', appeal: 'Appeal', appealReason: 'Enter appeal reason:', confirmRevoke: 'Confirm revoke?' },
      stats: { title: 'Statistics', ranking: 'Rankings', trend: 'Trend', detail: 'Details', exportCSV: 'Export CSV', selectClass: 'Select a class', selectGrade: 'All Grades', recentTrend: '8-Week Trend' },
      summary: { title: 'Daily Summary', newSummary: 'New Summary', date: 'Date', content: 'Content (Markdown)', autoHint: 'Leave blank to auto-generate...', historySummaries: 'History', autoContent: 'No records today.', weekRanking: '{week} Rankings' },
      appeals: { title: 'Appeals', allStatus: 'All', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', teacher: 'Appellant', reason: 'Reason', reviewer: 'Reviewer', approve: 'Approve', reject: 'Reject', reviewComment: 'Approved', rejectComment: 'Rejected' },
      awards: { title: 'Red Flag Awards', awardButton: 'Award Red Flag', awarding: 'Awarding...', confirmAward: 'Confirm {week} red flag? Top class per grade will be selected.', noRecords: 'No awards yet. Click above to auto-award.', awardedAt: 'Awarded at' },
      config: { title: 'Configuration', tabs: { campuses: 'Campuses', grades: 'Grades', classes: 'Classes', users: 'Users', groups: 'Groups', tags: 'Tags', templates: 'Templates' }, newItem: 'New', editItem: 'Edit', deleteConfirm: 'Confirm delete?' },
      settings: { title: 'Settings', campusSettings: 'Campus 1 Settings', appealToggle: 'Appeal Feature', appealDesc: 'Allow teachers to appeal duty records', notifyToggle: 'Auto-Notify', notifyDesc: 'Auto-push daily summaries to teachers', enabled: 'Enabled', disabled: 'Disabled', importTemplates: 'Import Templates', exportTemplates: 'Export Templates' },
      bigscreen: { title: 'Campus Duty Big Screen', todayRecords: 'Records', todayPositive: 'Positive', todayNegative: 'Negative', bestClass: 'Best', weekRankingTop10: 'Weekly Top 10', liveFeed: 'Live Feed' },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

export default i18n;