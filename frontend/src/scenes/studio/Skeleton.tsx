import { Skeleton, SkeletonText } from '../../design/ui';
import './Studio.css';

/**
 * The shape of the studio while it is being read: a title, the review, the sections, a page of text. The page's
 * level-one heading is there from the start, out of sight so that this stays a skeleton: the title the studio
 * is headed with once it is read.
 */
export function StudioSkeleton({ title }: { title: string }) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <div className="sw-studio-skel" role="status" aria-busy="true">
        <span className="sr-only">Opening the report studio</span>
        <div className="sw-studio-skel__head" aria-hidden="true">
          <Skeleton width="6rem" height="0.75rem" />
          <Skeleton width="min(26rem, 80%)" height="2.25rem" radius="var(--r-sm)" />
          <Skeleton width="min(36rem, 100%)" height="3.5rem" radius="var(--r-pill)" />
        </div>
        <div className="sw-studio-skel__bench" aria-hidden="true">
          <div className="sw-studio-skel__outline">
            {[78, 92, 64, 84, 70, 88].map((width, index) => (
              <Skeleton key={index} width={`${width}%`} height="1.1rem" />
            ))}
          </div>
          <div className="sw-studio-skel__page">
            <Skeleton width="9rem" height="0.75rem" />
            <Skeleton width="min(30rem, 90%)" height="2.6rem" radius="var(--r-sm)" />
            <Skeleton width="11rem" height="1.6rem" radius="var(--r-pill)" />
            <SkeletonText lines={4} />
            <SkeletonText lines={5} />
          </div>
          <div className="sw-studio-skel__tools">
            <Skeleton width="100%" height="2.5rem" radius="var(--r-pill)" />
            <SkeletonText lines={3} />
            <SkeletonText lines={4} />
          </div>
        </div>
      </div>
    </>
  );
}
