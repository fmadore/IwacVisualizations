<?php
declare(strict_types=1);

namespace IwacVisualizations\Controller\Admin;

use IwacVisualizations\Data\Deployment;
use IwacVisualizations\Job\SyncData;
use Laminas\Form\Element;
use Laminas\Form\Form;
use Laminas\Mvc\Controller\AbstractActionController;
use Laminas\View\Model\ViewModel;

/**
 * Admin control surface for the precomputed-data delivery (issue #7).
 *
 * One page with a "Pull latest data" button that dispatches the SyncData job
 * (which downloads the GitHub release archive and unpacks it into
 * files/iwac-visualizations/). Job progress + logs appear in Admin → Jobs;
 * this controller only shows the last-sync status and dispatches the job,
 * guarding against an overlapping run.
 */
class DataController extends AbstractActionController
{
    /** Job statuses that mean a sync is still active. */
    const ACTIVE_STATUSES = ['starting', 'in_progress', 'stopping'];

    /** The three things a submitted sync form can lead to; see `syncDecision()`. */
    const DECISION_DISPATCH = 'dispatch';
    const DECISION_REFUSE = 'refuse';
    const DECISION_RECOVER = 'recover';

    /** @var \Omeka\File\Store\StoreInterface */
    protected $store;

    /** @var \Doctrine\ORM\EntityManager|null */
    protected $entityManager;

    public function __construct($store, $entityManager = null)
    {
        $this->store = $store;
        $this->entityManager = $entityManager;
    }

    public function indexAction()
    {
        $running = $this->findRunningSync();

        $view = new ViewModel([
            'form'     => $this->getSyncForm(),
            'lastSync' => $this->settings()->get(SyncData::SETTING_LAST_SYNC),
            'running'  => $running,
            'sites'    => $this->api()->search('sites')->getContent(),
            'health'   => $this->loadCorpusHealth(),
        ]);
        $view->setTemplate('iwac-visualizations/admin/data/index');
        return $view;
    }

    /**
     * The data tree, derived exactly as the sync job derives it — or null
     * when the file store is not a local directory, in which case there is
     * nothing on disk to read or to probe.
     */
    private function deployment(): ?Deployment
    {
        try {
            return Deployment::forStore($this->store);
        } catch (\RuntimeException $e) {
            return null;
        }
    }

    /**
     * Read the synced corpus-health.json (ROADMAP 9.10) from the file
     * store, if a data pull has delivered one. Returns the decoded
     * bundle or null — the view renders the meters only when present,
     * so pre-9.10 archives degrade to the old page silently.
     */
    private function loadCorpusHealth(): ?array
    {
        $deployment = $this->deployment();
        if ($deployment === null) {
            return null;
        }
        $path = $deployment->liveDir()
            . Deployment::generationPath($this->settings()->get(SyncData::SETTING_LAST_SYNC))
            . '/corpus-health.json';
        if (!is_readable($path)) {
            return null;
        }
        $decoded = json_decode((string) file_get_contents($path), true);
        return (is_array($decoded) && !empty($decoded['subsets'])) ? $decoded : null;
    }

    public function syncAction()
    {
        if (!$this->getRequest()->isPost()) {
            return $this->redirect()->toRoute('admin/iwac-visualizations');
        }

        $form = $this->getSyncForm();
        $form->setData($this->params()->fromPost());
        if (!$form->isValid()) {
            $this->messenger()->addError('Invalid or expired form submission. Please try again.'); // @translate
            return $this->redirect()->toRoute('admin/iwac-visualizations');
        }

        // Refuse to start a second sync while one is active — unless the
        // admin asked to recover and no worker holds the lock, which means
        // the "running" job is a record of a process that is gone.
        $running = $this->findRunningSync();
        $recover = (bool) $form->get('recover')->getValue();
        $deployment = ($running && $recover) ? $this->deployment() : null;
        $decision = self::syncDecision(
            $running !== null,
            $recover,
            $deployment !== null && !$deployment->isLocked()
        );
        if ($decision === self::DECISION_REFUSE) {
            $this->messenger()->addWarning('A data sync is already running.'); // @translate
            return $this->redirect()->toRoute('admin/id', [
                'controller' => 'job', 'action' => 'show', 'id' => $running->id(),
            ]);
        }
        if ($decision === self::DECISION_RECOVER && $this->retireStaleSync((int) $running->id())) {
            $this->messenger()->addWarning('The interrupted sync was marked as failed: no worker held the data lock.'); // @translate
        }

        $args = [];
        $tag = trim((string) $form->get('tag')->getValue());
        if ($tag !== '') {
            $args['tag'] = $tag;
        }

        $job = $this->jobDispatcher()->dispatch(SyncData::class, $args);
        $this->messenger()->addSuccess('Data sync started. Watch its progress below.'); // @translate

        return $this->redirect()->toRoute('admin/id', [
            'controller' => 'job', 'action' => 'show', 'id' => $job->getId(),
        ]);
    }

    /**
     * What a valid sync submission does.
     *
     *   - nothing running              → dispatch a new job;
     *   - running, no recovery asked   → refuse, and point at the running job;
     *   - running, recovery asked, but a worker holds the lock (or the lock
     *     cannot be probed)            → refuse: the job is genuinely alive;
     *   - running, recovery asked, lock free → recover: close the stale job,
     *     then dispatch.
     *
     * Pure, so the table above is tested without a request or a database.
     */
    public static function syncDecision(bool $running, bool $recoverRequested, bool $lockFree): string
    {
        if (!$running) {
            return self::DECISION_DISPATCH;
        }
        return ($recoverRequested && $lockFree) ? self::DECISION_RECOVER : self::DECISION_REFUSE;
    }

    /**
     * Close a sync job whose worker is gone: status `error`, an end time, a
     * line in its own log saying why.
     *
     * Recovery used to dispatch the replacement and leave the dead job's row
     * as it was — `in_progress` or `stopping` — so `findRunningSync()` went
     * on returning it, every later pull needed the recovery box again, and
     * the admin page reported a sync running forever. Only a job still in an
     * active status is touched; one that finished in the meantime is left as
     * it ended.
     *
     * @return bool whether a job was closed
     */
    protected function retireStaleSync(int $jobId): bool
    {
        if (!$this->entityManager) {
            return false;
        }
        $job = $this->entityManager->find(\Omeka\Entity\Job::class, $jobId);
        if (!$job || !in_array($job->getStatus(), self::ACTIVE_STATUSES, true)) {
            return false;
        }
        $previous = (string) $job->getStatus();
        $job->setStatus(\Omeka\Entity\Job::STATUS_ERROR);
        $job->setEnded(new \DateTime('now'));
        $job->addLog(sprintf(
            'IWAC data sync: marked as failed by an admin recovery — the job was "%s" but no worker held the data lock.',
            $previous
        ));
        $this->entityManager->flush();
        $this->logger()->warn(sprintf(
            'IWAC data sync: job #%d was "%s" with no worker holding the data lock; marked as failed so a new sync could start.',
            $jobId,
            $previous
        ));
        return true;
    }

    /**
     * Find an active SyncData job, if any (newest first).
     *
     * @return \Omeka\Api\Representation\JobRepresentation|null
     */
    private function findRunningSync()
    {
        foreach (self::ACTIVE_STATUSES as $status) {
            $response = $this->api()->search('jobs', [
                'class'  => SyncData::class,
                'status' => $status,
                'sort_by' => 'id',
                'sort_order' => 'desc',
                'limit'  => 1,
            ]);
            $content = $response->getContent();
            if (!empty($content)) {
                return $content[0];
            }
        }
        return null;
    }

    /** Build the sync form: a CSRF token + an optional release-tag override. */
    private function getSyncForm(): Form
    {
        $form = new Form('iwac-sync');
        $form->setAttribute('method', 'post');
        $form->setAttribute('action', $this->url()->fromRoute('admin/iwac-visualizations/sync'));

        $form->add([
            'type'    => Element\Text::class,
            'name'    => 'tag',
            'options' => [
                'label' => 'Release tag (optional)', // @translate
                'info'  => 'Leave blank to pull the latest build from the moving “data” release.', // @translate
            ],
            'attributes' => [
                'id'          => 'iwac-sync-tag',
                'placeholder' => 'data',
            ],
        ]);

        $form->add([
            'type' => Element\Checkbox::class,
            'name' => 'recover',
            'options' => [
                'label' => 'Retry an interrupted sync if no worker holds the data lock', // @translate
            ],
        ]);

        $form->add([
            'type' => Element\Csrf::class,
            'name' => 'sync_token',
        ]);

        // The recovery checkbox is rendered only while a sync is running.
        // Its absence is the normal submission, not a validation failure.
        // Keep Checkbox's value validator and the CSRF input intact.
        $form->getInputFilter()->get('recover')->setRequired(false);

        return $form;
    }
}
